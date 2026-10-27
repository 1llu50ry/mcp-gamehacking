"""GitHub repository analysis and quality assessment engine."""

import asyncio
import re
import math
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Set, Any
from github import Github, Repository, GithubException
from textblob import TextBlob
import requests

from models import (
    GitHubRepository, RepositoryContent, RepositoryCategory, QualityScore,
    RepositoryLanguage, MiningStatus
)
from config import settings
from logging_config import get_logger

logger = get_logger(__name__)


class GitHubAnalyzer:
    """Analyzes GitHub repositories for security relevance and quality."""

    def __init__(self, github_token: Optional[str] = None):
        self.github_token = github_token or settings.github_token
        self.github_client = Github(self.github_token) if self.github_token else None

        if not self.github_client:
            logger.warning("No GitHub token provided - running in limited mode")

    async def search_repositories(
        self,
        query: str,
        max_results: int = 100,
        min_stars: int = 0
    ) -> List[GitHubRepository]:
        """Search GitHub repositories with quality filtering."""
        if not self.github_client:
            logger.error("GitHub client not initialized - token required for search")
            return []

        repositories = []
        try:
            # Construct search query with filters
            search_query = f"{query} stars:>={min_stars}"
            if not settings.include_forks:
                search_query += " fork:false"

            logger.info("Searching GitHub repositories",
                       query=search_query,
                       max_results=max_results)

            # Search repositories
            search_result = self.github_client.search_repositories(
                query=search_query,
                sort="stars",
                order="desc"
            )

            count = 0
            for repo in search_result:
                if count >= max_results:
                    break

                try:
                    # Convert to our model
                    gh_repo = await self._convert_repository(repo)

                    # Apply quality filters
                    if await self._passes_quality_filters(gh_repo, repo):
                        repositories.append(gh_repo)
                        count += 1

                except Exception as e:
                    logger.warning("Failed to process repository",
                                 repo_name=repo.full_name,
                                 error=str(e))
                    continue

            logger.info("Repository search completed",
                       found=len(repositories),
                       query=query)

        except GithubException as e:
            logger.error("GitHub API error during search",
                        error=str(e),
                        query=query)

        return repositories

    async def analyze_repository_quality(
        self,
        repo: GitHubRepository,
        github_repo: Optional[Repository.Repository] = None
    ) -> Tuple[float, QualityScore, RepositoryContent]:
        """Comprehensive repository quality analysis."""
        if not github_repo and self.github_client:
            try:
                github_repo = self.github_client.get_repo(repo.full_name)
            except GithubException as e:
                logger.error("Failed to fetch repository for analysis",
                           repo_name=repo.full_name,
                           error=str(e))
                return 0.0, QualityScore.VERY_POOR, RepositoryContent(repo_id=repo.repo_id)

        # Initialize content analysis
        content = RepositoryContent(repo_id=repo.repo_id)

        # Calculate quality metrics
        quality_metrics = {}

        # 1. Repository activity and maintenance (25 points)
        quality_metrics['activity'] = await self._assess_activity(repo, github_repo)

        # 2. Documentation quality (20 points)
        quality_metrics['documentation'] = await self._assess_documentation(github_repo, content)

        # 3. Code quality indicators (20 points)
        quality_metrics['code_quality'] = await self._assess_code_quality(github_repo, content)

        # 4. Community engagement (15 points)
        quality_metrics['community'] = await self._assess_community_engagement(repo)

        # 5. Security and best practices (10 points)
        quality_metrics['security'] = await self._assess_security_practices(github_repo, content)

        # 6. Relevance to domain (10 points)
        quality_metrics['relevance'] = await self._assess_domain_relevance(repo, github_repo, content)

        # Calculate total quality score
        total_score = sum(quality_metrics.values())
        quality_grade = self._score_to_grade(total_score)

        # Update repository quality
        repo.quality_score = total_score
        repo.quality_grade = quality_grade

        logger.debug("Repository quality analysis completed",
                    repo_name=repo.full_name,
                    quality_score=total_score,
                    grade=quality_grade.value,
                    metrics=quality_metrics)

        return total_score, quality_grade, content

    async def _convert_repository(self, github_repo: Repository.Repository) -> GitHubRepository:
        """Convert GitHub API repository to our model."""
        # Determine primary language
        primary_lang = RepositoryLanguage.OTHER
        if github_repo.language:
            lang_mapping = {
                "Python": RepositoryLanguage.PYTHON,
                "C": RepositoryLanguage.C,
                "C++": RepositoryLanguage.CPP,
                "JavaScript": RepositoryLanguage.JAVASCRIPT,
                "Go": RepositoryLanguage.GO,
                "Rust": RepositoryLanguage.RUST,
                "Java": RepositoryLanguage.JAVA,
                "C#": RepositoryLanguage.CSHARP,
                "Shell": RepositoryLanguage.SHELL,
                "Assembly": RepositoryLanguage.ASSEMBLY,
            }
            primary_lang = lang_mapping.get(github_repo.language, RepositoryLanguage.OTHER)

        # Determine category based on description and topics
        category = await self._classify_repository(github_repo)

        return GitHubRepository(
            github_id=github_repo.id,
            full_name=github_repo.full_name,
            name=github_repo.name,
            owner=github_repo.owner.login,
            description=github_repo.description,
            homepage=github_repo.homepage if github_repo.homepage else None,
            topics=list(github_repo.get_topics()) if hasattr(github_repo, 'get_topics') else [],
            language=github_repo.language,
            primary_language=primary_lang,
            stars_count=github_repo.stargazers_count,
            forks_count=github_repo.forks_count,
            watchers_count=github_repo.watchers_count,
            issues_count=github_repo.open_issues_count,
            size_kb=github_repo.size,
            is_fork=github_repo.fork,
            is_archived=github_repo.archived,
            is_private=github_repo.private,
            has_wiki=github_repo.has_wiki,
            has_pages=github_repo.has_pages,
            created_at=github_repo.created_at,
            updated_at=github_repo.updated_at,
            pushed_at=github_repo.pushed_at,
            category=category
        )

    async def _classify_repository(self, repo: Repository.Repository) -> RepositoryCategory:
        """Classify repository based on content analysis."""
        text = f"{repo.name} {repo.description or ''}"
        text_lower = text.lower()

        # Classification keywords
        classifications = {
            RepositoryCategory.REVERSE_ENGINEERING: [
                'reverse engineering', 'disassembly', 'decompiler', 'binary analysis',
                'ghidra', 'ida', 'radare2', 'static analysis', 'dynamic analysis'
            ],
            RepositoryCategory.MALWARE_ANALYSIS: [
                'malware', 'virus', 'trojan', 'ransomware', 'malware analysis',
                'sandbox', 'behavioral analysis', 'yara', 'cuckoo'
            ],
            RepositoryCategory.BINARY_ANALYSIS: [
                'binary', 'executable', 'elf', 'pe', 'binary similarity',
                'function matching', 'bsim', 'bindiff'
            ],
            RepositoryCategory.SECURITY_RESEARCH: [
                'security research', 'vulnerability', 'cve', 'exploit',
                'penetration testing', 'security audit'
            ],
            RepositoryCategory.EXPLOITATION: [
                'exploit', 'payload', 'shellcode', 'rop', 'buffer overflow',
                'heap spray', 'privilege escalation'
            ],
            RepositoryCategory.FORENSICS: [
                'forensics', 'digital forensics', 'incident response',
                'memory dump', 'disk image', 'artifact analysis'
            ],
            RepositoryCategory.CRYPTOGRAPHY: [
                'cryptography', 'encryption', 'decryption', 'crypto',
                'cipher', 'hash', 'cryptanalysis'
            ],
            RepositoryCategory.VULNERABILITY_RESEARCH: [
                'vulnerability research', 'bug bounty', '0day', 'zero day',
                'fuzzing', 'code audit'
            ],
            RepositoryCategory.TOOLS_FRAMEWORKS: [
                'framework', 'toolkit', 'suite', 'platform',
                'automation', 'workflow'
            ],
            RepositoryCategory.EDUCATIONAL: [
                'tutorial', 'learning', 'education', 'course',
                'example', 'demo', 'workshop'
            ]
        }

        # Score each category
        category_scores = {}
        for category, keywords in classifications.items():
            score = sum(1 for keyword in keywords if keyword in text_lower)
            if score > 0:
                category_scores[category] = score

        # Return highest scoring category or OTHER
        if category_scores:
            return max(category_scores, key=category_scores.get)
        else:
            return RepositoryCategory.OTHER

    async def _passes_quality_filters(
        self,
        repo: GitHubRepository,
        github_repo: Repository.Repository
    ) -> bool:
        """Apply basic quality filters to repositories."""
        # Size filter
        if repo.size_kb > settings.max_repo_size_mb * 1024:
            logger.debug("Repository too large", repo_name=repo.full_name, size_kb=repo.size_kb)
            return False

        # Language filter
        if not settings.is_relevant_language(repo.language):
            logger.debug("Repository language not relevant", repo_name=repo.full_name, language=repo.language)
            return False

        # Archive filter
        if repo.is_archived:
            logger.debug("Repository is archived", repo_name=repo.full_name)
            return False

        # Security relevance filter
        description_text = f"{repo.name} {repo.description or ''} {' '.join(repo.topics)}"
        if not settings.is_security_relevant(description_text):
            logger.debug("Repository not security relevant", repo_name=repo.full_name)
            return False

        return True

    async def _assess_activity(
        self,
        repo: GitHubRepository,
        github_repo: Optional[Repository.Repository]
    ) -> float:
        """Assess repository activity and maintenance (max 25 points)."""
        score = 0.0

        # Recent activity (10 points)
        if repo.pushed_at:
            days_since_push = (datetime.now() - repo.pushed_at.replace(tzinfo=None)).days
            if days_since_push < 30:
                score += 10
            elif days_since_push < 90:
                score += 7
            elif days_since_push < 180:
                score += 4
            elif days_since_push < 365:
                score += 2

        # Repository age (5 points) - mature but not too old
        if repo.created_at:
            days_old = (datetime.now() - repo.created_at.replace(tzinfo=None)).days
            if 180 <= days_old <= 1825:  # 6 months to 5 years
                score += 5
            elif 90 <= days_old < 180 or 1825 < days_old <= 2555:  # 3-6 months or 5-7 years
                score += 3
            elif 30 <= days_old < 90:  # 1-3 months
                score += 2

        # Community engagement (10 points)
        engagement_score = min(10, math.log10(repo.stars_count + 1) * 2)
        score += engagement_score

        return min(25.0, score)

    async def _assess_documentation(
        self,
        github_repo: Optional[Repository.Repository],
        content: RepositoryContent
    ) -> float:
        """Assess documentation quality (max 20 points)."""
        if not github_repo:
            return 0.0

        score = 0.0

        try:
            # Check for README (10 points)
            try:
                readme = github_repo.get_readme()
                if readme and readme.size > 500:  # Substantial README
                    score += 10
                    content.has_readme = True
                elif readme:
                    score += 5
                    content.has_readme = True
            except:
                pass

            # Check for license (5 points)
            try:
                license_info = github_repo.get_license()
                if license_info:
                    score += 5
                    content.has_license = True
            except:
                pass

            # Check for documentation directory or wiki (5 points)
            try:
                contents = github_repo.get_contents(".")
                doc_indicators = ['docs', 'doc', 'documentation', 'wiki']
                for item in contents:
                    if item.type == "dir" and any(indicator in item.name.lower()
                                                for indicator in doc_indicators):
                        score += 5
                        content.has_documentation = True
                        break
            except:
                pass

        except Exception as e:
            logger.debug("Error assessing documentation", repo_name=github_repo.full_name, error=str(e))

        return min(20.0, score)

    async def _assess_code_quality(
        self,
        github_repo: Optional[Repository.Repository],
        content: RepositoryContent
    ) -> float:
        """Assess code quality indicators (max 20 points)."""
        if not github_repo:
            return 0.0

        score = 0.0

        try:
            # Check for test directories (10 points)
            contents = github_repo.get_contents(".")
            test_indicators = ['test', 'tests', 'spec', 'specs', '__tests__']
            for item in contents:
                if item.type == "dir" and any(indicator in item.name.lower()
                                            for indicator in test_indicators):
                    score += 10
                    content.has_tests = True
                    break

            # Check for CI/CD configuration (5 points)
            ci_files = ['.github/workflows', '.travis.yml', 'Jenkinsfile',
                       '.gitlab-ci.yml', 'azure-pipelines.yml']
            for ci_file in ci_files:
                try:
                    github_repo.get_contents(ci_file)
                    score += 5
                    content.has_ci_cd = True
                    break
                except:
                    continue

            # Code structure assessment (5 points)
            file_count = 0
            try:
                for item in contents:
                    if item.type == "file":
                        file_count += 1

                # Well-structured projects have reasonable file counts
                if 5 <= file_count <= 200:
                    score += 5
                elif 3 <= file_count <= 300:
                    score += 3

                content.total_files = file_count

            except Exception as e:
                logger.debug("Error counting files", error=str(e))

        except Exception as e:
            logger.debug("Error assessing code quality", repo_name=github_repo.full_name, error=str(e))

        return min(20.0, score)

    async def _assess_community_engagement(self, repo: GitHubRepository) -> float:
        """Assess community engagement (max 15 points)."""
        score = 0.0

        # Star count (8 points)
        if repo.stars_count >= 1000:
            score += 8
        elif repo.stars_count >= 100:
            score += 6
        elif repo.stars_count >= 50:
            score += 4
        elif repo.stars_count >= 10:
            score += 2

        # Fork count (4 points)
        if repo.forks_count >= 100:
            score += 4
        elif repo.forks_count >= 20:
            score += 3
        elif repo.forks_count >= 5:
            score += 2
        elif repo.forks_count >= 1:
            score += 1

        # Issues/Discussion (3 points)
        if repo.issues_count >= 10:
            score += 3
        elif repo.issues_count >= 5:
            score += 2
        elif repo.issues_count >= 1:
            score += 1

        return min(15.0, score)

    async def _assess_security_practices(
        self,
        github_repo: Optional[Repository.Repository],
        content: RepositoryContent
    ) -> float:
        """Assess security practices (max 10 points)."""
        if not github_repo:
            return 0.0

        score = 0.0

        try:
            # Check for security-related files (5 points)
            security_files = ['SECURITY.md', 'security.md', '.security.txt']
            for sec_file in security_files:
                try:
                    github_repo.get_contents(sec_file)
                    score += 5
                    break
                except:
                    continue

            # Check for dependency management (3 points)
            dep_files = ['requirements.txt', 'package.json', 'Gemfile',
                        'pom.xml', 'Cargo.toml', 'go.mod']
            for dep_file in dep_files:
                try:
                    github_repo.get_contents(dep_file)
                    score += 3
                    break
                except:
                    continue

            # Check for code scanning/linting config (2 points)
            lint_files = ['.bandit', '.pylintrc', '.eslintrc', 'sonar-project.properties']
            for lint_file in lint_files:
                try:
                    github_repo.get_contents(lint_file)
                    score += 2
                    break
                except:
                    continue

        except Exception as e:
            logger.debug("Error assessing security practices", error=str(e))

        return min(10.0, score)

    async def _assess_domain_relevance(
        self,
        repo: GitHubRepository,
        github_repo: Optional[Repository.Repository],
        content: RepositoryContent
    ) -> float:
        """Assess relevance to security/reverse engineering domain (max 10 points)."""
        score = 0.0

        # Analyze text content for relevance
        text_content = f"{repo.name} {repo.description or ''} {' '.join(repo.topics)}"

        # Count domain-specific keywords
        ghidra_keywords = ['ghidra', 'bsim', 'pcode', 'sleigh']
        re_keywords = settings.reverse_engineering_keywords
        security_keywords = settings.security_keywords

        ghidra_count = sum(1 for keyword in ghidra_keywords if keyword in text_content.lower())
        re_count = sum(1 for keyword in re_keywords if keyword in text_content.lower())
        security_count = sum(1 for keyword in security_keywords if keyword in text_content.lower())

        # Update content metrics
        content.ghidra_mentions = ghidra_count
        content.reverse_engineering_keywords = re_count
        content.binary_analysis_keywords = security_count

        # Calculate relevance score
        if ghidra_count > 0:
            score += 5  # Directly relevant to Ghidra/BSim
        if re_count >= 3:
            score += 3  # Strong RE focus
        elif re_count >= 1:
            score += 1
        if security_count >= 2:
            score += 2  # Security focus

        # Category bonus
        if repo.category in [RepositoryCategory.REVERSE_ENGINEERING,
                           RepositoryCategory.BINARY_ANALYSIS]:
            score += 2

        # Calculate overall relevance score (0.0-1.0)
        repo.relevance_score = min(1.0, (ghidra_count * 0.3 + re_count * 0.1 + security_count * 0.05))

        return min(10.0, score)

    def _score_to_grade(self, score: float) -> QualityScore:
        """Convert numeric score to quality grade."""
        if score >= 90:
            return QualityScore.EXCELLENT
        elif score >= 70:
            return QualityScore.GOOD
        elif score >= 50:
            return QualityScore.FAIR
        elif score >= 30:
            return QualityScore.POOR
        else:
            return QualityScore.VERY_POOR

    async def get_rate_limit_info(self) -> Dict[str, Any]:
        """Get GitHub API rate limit information."""
        if not self.github_client:
            return {"available": False}

        try:
            rate_limit = self.github_client.get_rate_limit()
            return {
                "available": True,
                "core": {
                    "limit": rate_limit.core.limit,
                    "remaining": rate_limit.core.remaining,
                    "reset": rate_limit.core.reset
                },
                "search": {
                    "limit": rate_limit.search.limit,
                    "remaining": rate_limit.search.remaining,
                    "reset": rate_limit.search.reset
                }
            }
        except Exception as e:
            logger.error("Failed to get rate limit info", error=str(e))
            return {"available": False, "error": str(e)}