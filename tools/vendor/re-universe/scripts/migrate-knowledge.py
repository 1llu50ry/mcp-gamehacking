#!/usr/bin/env python3
"""
Knowledge Migration Script
Migrates existing D2 research markdown files to Knowledge DB
"""

import asyncio
import asyncpg
import json
import re
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

# Knowledge DB connection settings
DATABASE_URL = "postgresql://ben:goodyx12@localhost:5432/bsim"

class KnowledgeMigrator:
    def __init__(self):
        self.db_pool = None
        self.project_root = Path(__file__).parent.parent
        self.research_dir = self.project_root / "ghidra-projects" / "diablo2" / "research"

    async def connect(self):
        """Connect to Knowledge DB"""
        self.db_pool = await asyncpg.create_pool(DATABASE_URL)
        print("✅ Connected to Knowledge DB")

    async def close(self):
        """Close database connections"""
        if self.db_pool:
            await self.db_pool.close()

    async def setup_tables(self):
        """Ensure function_insights table exists"""
        async with self.db_pool.acquire() as conn:
            await conn.execute('''
                CREATE TABLE IF NOT EXISTS function_insights (
                    id SERIAL PRIMARY KEY,
                    function_id INTEGER,
                    function_name VARCHAR(255),
                    executable_id INTEGER,
                    github_repo_id VARCHAR(255),
                    confidence_score DOUBLE PRECISION DEFAULT 0.9,
                    insight_type VARCHAR(50),
                    insight_content TEXT,
                    evidence JSONB DEFAULT '[]',
                    last_updated TIMESTAMP DEFAULT NOW(),
                    source_file VARCHAR(255),
                    created_at TIMESTAMP DEFAULT NOW()
                );
            ''')

            # Create indices for performance
            await conn.execute('''
                CREATE INDEX IF NOT EXISTS idx_function_insights_function_id
                ON function_insights(function_id);
            ''')
            await conn.execute('''
                CREATE INDEX IF NOT EXISTS idx_function_insights_type
                ON function_insights(insight_type);
            ''')
            await conn.execute('''
                CREATE INDEX IF NOT EXISTS idx_function_insights_executable
                ON function_insights(executable_id);
            ''')

        print("✅ Database schema ready")

    def parse_d2_version_evolution(self, file_path: Path) -> List[Dict]:
        """Parse D2_VERSION_EVOLUTION_ANALYSIS.md into insights"""
        content = file_path.read_text()
        insights = []

        # Extract version-specific insights
        version_pattern = r'v(\d+\.\d+[a-z]?):.*?(\d+(?:,\d+)*)\s*bytes.*?-\s*(.+)'
        for match in re.finditer(version_pattern, content, re.IGNORECASE):
            version, size, description = match.groups()

            insights.append({
                'function_name': f'Game.exe_v{version}',
                'insight_type': 'evolution',
                'insight_content': f'Version {version}: {size} bytes - {description}',
                'confidence_score': 0.95,
                'evidence': [f'Binary size: {size} bytes', f'Version: {version}'],
                'source_file': str(file_path.name)
            })

        # Extract architecture insights
        if 'D2SERVER.DLL PRESENCE' in content:
            insights.append({
                'function_name': 'D2Server.dll',
                'insight_type': 'architecture',
                'insight_content': 'Server binary only present in v1.00 - accidentally released and never included again',
                'confidence_score': 1.0,
                'evidence': ['Historical analysis', 'Complete version collection comparison'],
                'source_file': str(file_path.name)
            })

        # Extract size evolution patterns
        if 'CLIENT EXECUTABLE EVOLUTION' in content:
            insights.append({
                'function_name': 'Game.exe',
                'insight_type': 'pattern',
                'insight_content': '11.7x size increase from v1.00 to v1.14d showing massive feature and complexity growth over 16-year timeline',
                'confidence_score': 0.98,
                'evidence': ['309,379 bytes (v1.00)', '3,614,696 bytes (v1.14d)', '16-year development timeline'],
                'source_file': str(file_path.name)
            })

        return insights

    def parse_d2_server_analysis(self, file_path: Path) -> List[Dict]:
        """Parse D2SERVER_PRELIMINARY_ANALYSIS.md into insights"""
        content = file_path.read_text()
        insights = []

        # Extract server characteristics
        if 'File Size: 84,480 bytes' in content:
            insights.append({
                'function_name': 'D2Server.dll',
                'insight_type': 'documentation',
                'insight_content': 'D2Server.dll is 84,480 bytes (84KB), compiled February 29, 2004 with Visual Studio 6.0. PE32 DLL with symbols stripped (release build).',
                'confidence_score': 1.0,
                'evidence': ['PE header analysis', 'File size: 84,480 bytes', 'Compile date: Feb 29, 2004'],
                'source_file': str(file_path.name)
            })

        # Extract comparison insights
        comparison_match = re.search(r'D2Server\.dll:\s*(\d+(?:,\d+)*)\s*bytes.*?D2Game\.dll:\s*(\d+(?:,\d+)*)\s*bytes.*?(\d+\.\d+)x larger', content, re.DOTALL)
        if comparison_match:
            server_size, game_size, ratio = comparison_match.groups()
            insights.append({
                'function_name': 'D2Server.dll',
                'insight_type': 'pattern',
                'insight_content': f'Server binary ({server_size} bytes) is {ratio}x smaller than D2Game.dll ({game_size} bytes), indicating focused server-specific implementation vs full client engine',
                'confidence_score': 0.95,
                'evidence': [f'Server size: {server_size} bytes', f'Client engine size: {game_size} bytes'],
                'source_file': str(file_path.name)
            })

        # Extract architecture insights
        if 'GUI Subsystem' in content:
            insights.append({
                'function_name': 'D2Server.dll',
                'insight_type': 'vulnerability',
                'insight_content': 'Server binary has GUI subsystem flag, suggesting possible windowed interface or development artifact - unusual for production server',
                'confidence_score': 0.8,
                'evidence': ['PE header analysis', 'Subsystem: GUI application'],
                'source_file': str(file_path.name)
            })

        return insights

    def parse_version_comparison_matrix(self, file_path: Path) -> List[Dict]:
        """Parse D2_VERSION_COMPARISON_MATRIX.md into insights"""
        content = file_path.read_text()
        insights = []

        # Extract era-based insights
        era_pattern = r'(\w+\s+ERA)\s+\(([^)]+)\):(.*?)(?=\w+\s+ERA|\Z)'
        for match in re.finditer(era_pattern, content, re.DOTALL):
            era_name, timeframe, era_content = match.groups()

            insights.append({
                'function_name': f'D2_Development_{era_name.replace(" ", "_")}',
                'insight_type': 'documentation',
                'insight_content': f'{era_name} ({timeframe}): {era_content.strip()[:500]}...',
                'confidence_score': 0.9,
                'evidence': [f'Timeframe: {timeframe}', 'Development era analysis'],
                'source_file': str(file_path.name)
            })

        # Extract version count insight
        if '25 Complete Versions' in content:
            insights.append({
                'function_name': 'D2_Collection',
                'insight_type': 'documentation',
                'insight_content': 'Complete collection of 25 D2 versions with 554 total binaries covering 25-year development timeline (2000-2016)',
                'confidence_score': 1.0,
                'evidence': ['25 complete versions', '554 total binaries', '25-year timeline'],
                'source_file': str(file_path.name)
            })

        return insights

    async def migrate_markdown_files(self):
        """Migrate all research markdown files to Knowledge DB"""
        if not self.research_dir.exists():
            print(f"❌ Research directory not found: {self.research_dir}")
            return

        total_insights = 0

        # Process specific research files
        research_files = [
            ("version-evolution/D2_VERSION_EVOLUTION_ANALYSIS.md", self.parse_d2_version_evolution),
            ("server-architecture/D2SERVER_PRELIMINARY_ANALYSIS.md", self.parse_d2_server_analysis),
            ("version-evolution/D2_VERSION_COMPARISON_MATRIX.md", self.parse_version_comparison_matrix),
        ]

        async with self.db_pool.acquire() as conn:
            for file_path, parser in research_files:
                full_path = self.research_dir / file_path
                if full_path.exists():
                    print(f"📄 Processing {file_path}")
                    insights = parser(full_path)

                    for insight in insights:
                        await conn.execute('''
                            INSERT INTO function_insights
                            (function_name, insight_type, insight_content, confidence_score, evidence, source_file)
                            VALUES ($1, $2, $3, $4, $5, $6)
                        ''',
                        insight['function_name'],
                        insight['insight_type'],
                        insight['insight_content'],
                        insight['confidence_score'],
                        json.dumps(insight['evidence']),
                        insight['source_file']
                        )

                    total_insights += len(insights)
                    print(f"  ✅ Migrated {len(insights)} insights")
                else:
                    print(f"  ❌ File not found: {full_path}")

        print(f"✅ Migration complete: {total_insights} total insights migrated")

    async def create_d2_function_links(self):
        """Link D2 function insights to actual BSim functions where possible"""
        async with self.db_pool.acquire() as conn:
            # Get D2 executables from BSim database
            d2_executables = await conn.fetch('''
                SELECT DISTINCT e.id, e.name_exec, gv.version_string
                FROM exetable e
                JOIN game_versions gv ON e.game_version = gv.id
                WHERE e.name_exec LIKE '%D2%' OR e.name_exec LIKE '%Game%'
                ORDER BY gv.id
            ''')

            print(f"🔗 Found {len(d2_executables)} D2 executables in BSim database")

            # Link version-specific insights to actual executables
            for exe in d2_executables:
                exe_id, exe_name, version = exe['id'], exe['name_exec'], exe['version_string']

                # Update insights that match this executable
                result = await conn.execute('''
                    UPDATE function_insights
                    SET executable_id = $1
                    WHERE function_name LIKE $2 AND executable_id IS NULL
                ''', exe_id, f'%{exe_name}%')

                if result != 'UPDATE 0':
                    print(f"  🔗 Linked insights to {exe_name} v{version}")

    async def generate_summary_report(self):
        """Generate summary of migrated knowledge"""
        async with self.db_pool.acquire() as conn:
            stats = await conn.fetchrow('''
                SELECT
                    COUNT(*) as total_insights,
                    COUNT(DISTINCT insight_type) as insight_types,
                    COUNT(DISTINCT source_file) as source_files,
                    AVG(confidence_score) as avg_confidence
                FROM function_insights
                WHERE source_file IS NOT NULL
            ''')

            type_breakdown = await conn.fetch('''
                SELECT insight_type, COUNT(*) as count
                FROM function_insights
                WHERE source_file IS NOT NULL
                GROUP BY insight_type
                ORDER BY count DESC
            ''')

            print("\n📊 Knowledge Migration Summary")
            print("=" * 50)
            print(f"Total insights migrated: {stats['total_insights']}")
            print(f"Insight types: {stats['insight_types']}")
            print(f"Source files processed: {stats['source_files']}")
            print(f"Average confidence score: {stats['avg_confidence']:.2f}")
            print("\nInsight type breakdown:")
            for row in type_breakdown:
                print(f"  {row['insight_type']}: {row['count']} insights")
            print()

async def main():
    """Main migration process"""
    migrator = KnowledgeMigrator()

    try:
        print("🚀 Starting Knowledge Migration")
        await migrator.connect()
        await migrator.setup_tables()
        await migrator.migrate_markdown_files()
        await migrator.create_d2_function_links()
        await migrator.generate_summary_report()
        print("✅ Knowledge migration completed successfully!")

    except Exception as e:
        print(f"❌ Migration failed: {e}")
        raise
    finally:
        await migrator.close()

if __name__ == "__main__":
    asyncio.run(main())