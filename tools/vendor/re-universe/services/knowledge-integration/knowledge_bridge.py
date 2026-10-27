"""
Knowledge Bridge - Integrates Ghidra MCP with Knowledge DB
Automatically captures function analysis and feeds insights to Knowledge DB
"""

import asyncio
import asyncpg
import httpx
import json
from datetime import datetime
from typing import Dict, List, Optional, Any
import structlog

logger = structlog.get_logger(__name__)

class GhidraKnowledgeBridge:
    """Bridges Ghidra MCP analysis with Knowledge DB storage"""

    def __init__(self, ghidra_url: str = "http://localhost:8089",
                 knowledge_url: str = "http://localhost:8083",
                 db_url: str = "postgresql://ben:goodyx12@localhost:5432/bsim"):
        self.ghidra_url = ghidra_url
        self.knowledge_url = knowledge_url
        self.db_url = db_url
        self.db_pool = None

    async def connect(self):
        """Initialize database connection"""
        self.db_pool = await asyncpg.create_pool(self.db_url)
        logger.info("Knowledge Bridge connected to database")

    async def close(self):
        """Close database connections"""
        if self.db_pool:
            await self.db_pool.close()

    async def capture_function_analysis(self, function_data: Dict) -> Optional[int]:
        """
        Capture function analysis from Ghidra and create knowledge insight

        Args:
            function_data: Dictionary containing:
                - function_id: BSim function ID
                - function_name: Function name
                - address: Function address
                - executable_id: Executable ID
                - decompilation: Decompiled code
                - analysis_results: Ghidra analysis results

        Returns:
            insight_id if created, None if skipped
        """
        try:
            # Extract insights from function analysis
            insights = self._extract_insights_from_analysis(function_data)

            if not insights:
                return None

            # Store insights in Knowledge DB
            insight_id = await self._store_function_insights(insights)

            logger.info(
                "Function analysis captured",
                function_id=function_data.get('function_id'),
                function_name=function_data.get('function_name'),
                insight_id=insight_id
            )

            return insight_id

        except Exception as e:
            logger.error(
                "Failed to capture function analysis",
                error=str(e),
                function_data=function_data
            )
            return None

    def _extract_insights_from_analysis(self, function_data: Dict) -> List[Dict]:
        """Extract meaningful insights from Ghidra function analysis"""
        insights = []

        # Pattern recognition insights
        if 'decompilation' in function_data:
            decompilation = function_data['decompilation']

            # Network function patterns
            if any(net_keyword in decompilation.lower() for net_keyword in
                   ['socket', 'recv', 'send', 'connect', 'bind', 'listen']):
                insights.append({
                    'insight_type': 'pattern',
                    'insight_content': f'Network communication function - contains socket operations',
                    'confidence_score': 0.8,
                    'evidence': ['Decompilation contains network keywords'],
                })

            # Crypto/security patterns
            if any(crypto_keyword in decompilation.lower() for crypto_keyword in
                   ['encrypt', 'decrypt', 'hash', 'md5', 'sha', 'crc']):
                insights.append({
                    'insight_type': 'vulnerability',
                    'insight_content': f'Cryptographic function - handles encryption/hashing operations',
                    'confidence_score': 0.85,
                    'evidence': ['Decompilation contains cryptographic keywords'],
                })

            # String manipulation patterns
            if any(string_keyword in decompilation.lower() for string_keyword in
                   ['strcpy', 'sprintf', 'strcat', 'memcpy']):
                insights.append({
                    'insight_type': 'vulnerability',
                    'insight_content': f'String manipulation function - potential buffer overflow risk',
                    'confidence_score': 0.7,
                    'evidence': ['Contains potentially unsafe string functions'],
                })

        # Function complexity insights
        if 'analysis_results' in function_data:
            analysis = function_data['analysis_results']

            # High complexity functions
            if analysis.get('cyclomatic_complexity', 0) > 20:
                insights.append({
                    'insight_type': 'pattern',
                    'insight_content': f'High complexity function (complexity: {analysis["cyclomatic_complexity"]}) - candidate for refactoring',
                    'confidence_score': 0.9,
                    'evidence': [f'Cyclomatic complexity: {analysis["cyclomatic_complexity"]}'],
                })

            # Large functions
            if analysis.get('instruction_count', 0) > 1000:
                insights.append({
                    'insight_type': 'pattern',
                    'insight_content': f'Large function ({analysis["instruction_count"]} instructions) - possible code smell',
                    'confidence_score': 0.8,
                    'evidence': [f'Instruction count: {analysis["instruction_count"]}'],
                })

        # Add common metadata to all insights
        for insight in insights:
            insight.update({
                'function_id': function_data.get('function_id'),
                'function_name': function_data.get('function_name'),
                'executable_id': function_data.get('executable_id'),
                'source_file': 'ghidra_mcp_analysis',
                'last_updated': datetime.utcnow()
            })

        return insights

    async def _store_function_insights(self, insights: List[Dict]) -> Optional[int]:
        """Store insights in Knowledge DB"""
        if not insights:
            return None

        async with self.db_pool.acquire() as conn:
            # Store each insight
            last_insight_id = None
            for insight in insights:
                insight_id = await conn.fetchval('''
                    INSERT INTO function_insights
                    (function_id, function_name, executable_id, confidence_score,
                     insight_type, insight_content, evidence, source_file, last_updated)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    RETURNING id
                ''',
                insight['function_id'],
                insight['function_name'],
                insight['executable_id'],
                insight['confidence_score'],
                insight['insight_type'],
                insight['insight_content'],
                json.dumps(insight['evidence']),
                insight['source_file'],
                insight['last_updated']
                )
                last_insight_id = insight_id

        return last_insight_id

    async def process_bsim_similarity_results(self, similarity_data: Dict) -> List[int]:
        """
        Process BSim similarity results and create pattern insights

        Args:
            similarity_data: Dictionary containing:
                - source_function_id: Source function ID
                - matches: List of similar functions with scores
                - threshold: Similarity threshold used

        Returns:
            List of created insight IDs
        """
        try:
            insights = []
            source_id = similarity_data['source_function_id']
            matches = similarity_data['matches']
            threshold = similarity_data.get('threshold', 0.6)

            # High similarity insights
            high_similarity_matches = [m for m in matches if m['similarity'] > 0.9]
            if high_similarity_matches:
                evidence = [f"Function {m['function_id']} (similarity: {m['similarity']:.2f})"
                           for m in high_similarity_matches[:5]]

                insights.append({
                    'function_id': source_id,
                    'insight_type': 'pattern',
                    'insight_content': f'High similarity pattern found - {len(high_similarity_matches)} functions with >90% similarity',
                    'confidence_score': 0.95,
                    'evidence': evidence,
                    'source_file': 'bsim_similarity_analysis'
                })

            # Cross-version pattern insights
            version_groups = {}
            for match in matches:
                version = match.get('version', 'unknown')
                if version not in version_groups:
                    version_groups[version] = []
                version_groups[version].append(match)

            if len(version_groups) > 3:  # Function appears across multiple versions
                insights.append({
                    'function_id': source_id,
                    'insight_type': 'pattern',
                    'insight_content': f'Cross-version stable function - appears in {len(version_groups)} versions',
                    'confidence_score': 0.85,
                    'evidence': [f"Present in versions: {', '.join(version_groups.keys())}"],
                    'source_file': 'bsim_similarity_analysis'
                })

            # Store insights
            insight_ids = []
            for insight in insights:
                insight_id = await self._store_function_insights([insight])
                if insight_id:
                    insight_ids.append(insight_id)

            logger.info(
                "BSim similarity processed",
                source_function_id=source_id,
                matches_processed=len(matches),
                insights_created=len(insight_ids)
            )

            return insight_ids

        except Exception as e:
            logger.error(
                "Failed to process BSim similarity results",
                error=str(e),
                similarity_data=similarity_data
            )
            return []

    async def sync_with_ghidra_analysis(self):
        """Sync with ongoing Ghidra analysis and capture insights"""
        try:
            async with httpx.AsyncClient() as client:
                # Check if Ghidra MCP is available
                response = await client.get(f"{self.ghidra_url}/health")
                if response.status_code != 200:
                    logger.warning("Ghidra MCP not available", url=self.ghidra_url)
                    return

                # Get recent function analyses (this would be implemented based on actual Ghidra MCP API)
                # For now, this is a placeholder for the integration point
                logger.info("Ghidra MCP sync placeholder - implement based on actual API")

        except Exception as e:
            logger.error("Failed to sync with Ghidra analysis", error=str(e))

    async def get_insights_for_function(self, function_id: int) -> List[Dict]:
        """Get all insights for a specific function"""
        async with self.db_pool.acquire() as conn:
            insights = await conn.fetch('''
                SELECT
                    id, insight_type, insight_content, confidence_score,
                    evidence, source_file, last_updated
                FROM function_insights
                WHERE function_id = $1
                ORDER BY confidence_score DESC, last_updated DESC
            ''', function_id)

            return [dict(insight) for insight in insights]

# Webhook handler for Ghidra MCP integration
class GhidraAnalysisWebhook:
    """Webhook handler for receiving Ghidra analysis results"""

    def __init__(self, bridge: GhidraKnowledgeBridge):
        self.bridge = bridge

    async def handle_function_analysis(self, analysis_data: Dict) -> Dict:
        """Handle incoming function analysis from Ghidra MCP"""
        try:
            insight_id = await self.bridge.capture_function_analysis(analysis_data)

            return {
                'status': 'success',
                'insight_id': insight_id,
                'timestamp': datetime.utcnow().isoformat()
            }

        except Exception as e:
            logger.error("Webhook handling failed", error=str(e))
            return {
                'status': 'error',
                'error': str(e),
                'timestamp': datetime.utcnow().isoformat()
            }

    async def handle_bsim_results(self, similarity_data: Dict) -> Dict:
        """Handle incoming BSim similarity results"""
        try:
            insight_ids = await self.bridge.process_bsim_similarity_results(similarity_data)

            return {
                'status': 'success',
                'insight_ids': insight_ids,
                'insights_created': len(insight_ids),
                'timestamp': datetime.utcnow().isoformat()
            }

        except Exception as e:
            logger.error("BSim webhook handling failed", error=str(e))
            return {
                'status': 'error',
                'error': str(e),
                'timestamp': datetime.utcnow().isoformat()
            }