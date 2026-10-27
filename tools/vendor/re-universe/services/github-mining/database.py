"""Database operations for GitHub mining service."""

import asyncio
import asyncpg
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from models import (
    GitHubRepository, RepositoryContent, GitHubUser, MiningTask, KnowledgeExtract,
    MiningStatus, RepositoryCategory, QualityScore, RepositoryLanguage
)
from config import settings
from logging_config import get_logger

logger = get_logger(__name__)


class GitHubMiningDatabase:
    """Database manager for GitHub mining service."""

    def __init__(self):
        self.pool: Optional[asyncpg.Pool] = None

    async def connect(self):
        """Establish database connection pool."""
        try:
            self.pool = await asyncpg.create_pool(
                host=settings.db_host,
                port=settings.db_port,
                user=settings.db_user,
                password=settings.db_password,
                database=settings.db_name,
                min_size=2,
                max_size=10,
                command_timeout=60
            )

            # Initialize database schema
            await self._init_schema()

            logger.info("GitHub mining database connection established",
                       host=settings.db_host,
                       database=settings.db_name)

        except Exception as e:
            logger.error("Failed to establish database connection", error=str(e))
            raise

    async def disconnect(self):
        """Close database connection pool."""
        if self.pool:
            await self.pool.close()
            logger.info("GitHub mining database connection closed")

    async def _init_schema(self):
        """Initialize database schema for GitHub mining."""
        async with self.pool.acquire() as conn:

            # Create github_repositories table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS github_repositories (
                    repo_id UUID PRIMARY KEY,
                    github_id BIGINT UNIQUE NOT NULL,
                    full_name VARCHAR(255) NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    owner VARCHAR(255) NOT NULL,
                    description TEXT,
                    homepage VARCHAR(500),
                    topics TEXT[] DEFAULT '{}',
                    language VARCHAR(100),
                    primary_language VARCHAR(50) NOT NULL DEFAULT 'other',
                    stars_count INTEGER DEFAULT 0,
                    forks_count INTEGER DEFAULT 0,
                    watchers_count INTEGER DEFAULT 0,
                    issues_count INTEGER DEFAULT 0,
                    size_kb INTEGER DEFAULT 0,
                    is_fork BOOLEAN DEFAULT FALSE,
                    is_archived BOOLEAN DEFAULT FALSE,
                    is_private BOOLEAN DEFAULT FALSE,
                    has_wiki BOOLEAN DEFAULT FALSE,
                    has_pages BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
                    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
                    pushed_at TIMESTAMP WITH TIME ZONE NOT NULL,
                    category VARCHAR(50) NOT NULL DEFAULT 'other',
                    relevance_score FLOAT DEFAULT 0.0,
                    quality_score FLOAT DEFAULT 0.0,
                    quality_grade VARCHAR(20) DEFAULT 'poor',
                    discovered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    last_analyzed TIMESTAMP WITH TIME ZONE,
                    mining_status VARCHAR(20) DEFAULT 'pending'
                )
            """)

            # Create repository_content table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS repository_content (
                    content_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    repo_id UUID NOT NULL REFERENCES github_repositories(repo_id) ON DELETE CASCADE,
                    total_files INTEGER DEFAULT 0,
                    code_files INTEGER DEFAULT 0,
                    documentation_files INTEGER DEFAULT 0,
                    config_files INTEGER DEFAULT 0,
                    lines_of_code INTEGER DEFAULT 0,
                    cyclomatic_complexity FLOAT DEFAULT 0.0,
                    maintainability_index FLOAT DEFAULT 0.0,
                    has_readme BOOLEAN DEFAULT FALSE,
                    has_license BOOLEAN DEFAULT FALSE,
                    has_tests BOOLEAN DEFAULT FALSE,
                    has_ci_cd BOOLEAN DEFAULT FALSE,
                    has_documentation BOOLEAN DEFAULT FALSE,
                    security_issues TEXT[] DEFAULT '{}',
                    vulnerability_count INTEGER DEFAULT 0,
                    ghidra_mentions INTEGER DEFAULT 0,
                    bsim_mentions INTEGER DEFAULT 0,
                    reverse_engineering_keywords INTEGER DEFAULT 0,
                    binary_analysis_keywords INTEGER DEFAULT 0,
                    analyzed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                )
            """)

            # Create github_users table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS github_users (
                    user_id UUID PRIMARY KEY,
                    github_id BIGINT UNIQUE NOT NULL,
                    login VARCHAR(255) NOT NULL,
                    name VARCHAR(255),
                    company VARCHAR(255),
                    location VARCHAR(255),
                    bio TEXT,
                    public_repos INTEGER DEFAULT 0,
                    followers INTEGER DEFAULT 0,
                    following INTEGER DEFAULT 0,
                    is_organization BOOLEAN DEFAULT FALSE,
                    credibility_score FLOAT DEFAULT 0.0,
                    discovered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                )
            """)

            # Create mining_tasks table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS mining_tasks (
                    task_id UUID PRIMARY KEY,
                    task_type VARCHAR(50) NOT NULL,
                    search_query VARCHAR(500),
                    repository_id UUID REFERENCES github_repositories(repo_id) ON DELETE SET NULL,
                    user_id UUID REFERENCES github_users(user_id) ON DELETE SET NULL,
                    priority INTEGER DEFAULT 5,
                    max_repositories INTEGER DEFAULT 100,
                    include_forks BOOLEAN DEFAULT FALSE,
                    min_stars INTEGER DEFAULT 0,
                    status VARCHAR(20) DEFAULT 'pending',
                    progress FLOAT DEFAULT 0.0,
                    repositories_found INTEGER DEFAULT 0,
                    repositories_analyzed INTEGER DEFAULT 0,
                    high_quality_found INTEGER DEFAULT 0,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    started_at TIMESTAMP WITH TIME ZONE,
                    completed_at TIMESTAMP WITH TIME ZONE,
                    error_message TEXT,
                    retry_count INTEGER DEFAULT 0
                )
            """)

            # Create knowledge_extracts table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS knowledge_extracts (
                    extract_id UUID PRIMARY KEY,
                    repo_id UUID NOT NULL REFERENCES github_repositories(repo_id) ON DELETE CASCADE,
                    file_path VARCHAR(1000) NOT NULL,
                    content_type VARCHAR(50) NOT NULL,
                    title VARCHAR(500) NOT NULL,
                    summary TEXT,
                    content TEXT,
                    keywords TEXT[] DEFAULT '{}',
                    relevance_score FLOAT DEFAULT 0.0,
                    confidence_score FLOAT DEFAULT 0.0,
                    techniques TEXT[] DEFAULT '{}',
                    tools_mentioned TEXT[] DEFAULT '{}',
                    vulnerability_types TEXT[] DEFAULT '{}',
                    extracted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                )
            """)

            # Create indexes for performance
            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_github_repos_category
                ON github_repositories(category)
            """)

            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_github_repos_quality
                ON github_repositories(quality_score DESC)
            """)

            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_github_repos_relevance
                ON github_repositories(relevance_score DESC)
            """)

            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_github_repos_stars
                ON github_repositories(stars_count DESC)
            """)

            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_mining_tasks_status
                ON mining_tasks(status, created_at)
            """)

            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_knowledge_extracts_relevance
                ON knowledge_extracts(relevance_score DESC)
            """)

            logger.info("GitHub mining database schema initialized successfully")

    async def save_repository(self, repo: GitHubRepository) -> GitHubRepository:
        """Save or update a repository record."""
        async with self.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO github_repositories (
                    repo_id, github_id, full_name, name, owner, description, homepage,
                    topics, language, primary_language, stars_count, forks_count,
                    watchers_count, issues_count, size_kb, is_fork, is_archived,
                    is_private, has_wiki, has_pages, created_at, updated_at, pushed_at,
                    category, relevance_score, quality_score, quality_grade,
                    discovered_at, last_analyzed, mining_status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                         $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
                         $25, $26, $27, $28, $29, $30)
                ON CONFLICT (github_id) DO UPDATE SET
                    full_name = EXCLUDED.full_name,
                    name = EXCLUDED.name,
                    description = EXCLUDED.description,
                    topics = EXCLUDED.topics,
                    language = EXCLUDED.language,
                    stars_count = EXCLUDED.stars_count,
                    forks_count = EXCLUDED.forks_count,
                    watchers_count = EXCLUDED.watchers_count,
                    issues_count = EXCLUDED.issues_count,
                    size_kb = EXCLUDED.size_kb,
                    updated_at = EXCLUDED.updated_at,
                    pushed_at = EXCLUDED.pushed_at,
                    relevance_score = EXCLUDED.relevance_score,
                    quality_score = EXCLUDED.quality_score,
                    quality_grade = EXCLUDED.quality_grade,
                    mining_status = EXCLUDED.mining_status
            """,
                repo.repo_id, repo.github_id, repo.full_name, repo.name, repo.owner,
                repo.description, str(repo.homepage) if repo.homepage else None,
                repo.topics, repo.language, repo.primary_language.value,
                repo.stars_count, repo.forks_count, repo.watchers_count,
                repo.issues_count, repo.size_kb, repo.is_fork, repo.is_archived,
                repo.is_private, repo.has_wiki, repo.has_pages, repo.created_at,
                repo.updated_at, repo.pushed_at, repo.category.value,
                repo.relevance_score, repo.quality_score, repo.quality_grade.value,
                repo.discovered_at, repo.last_analyzed, repo.mining_status.value
            )

        logger.debug("Repository saved", repo_id=repo.repo_id, full_name=repo.full_name)
        return repo

    async def get_repository(self, repo_id: str) -> Optional[GitHubRepository]:
        """Get a repository by ID."""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT * FROM github_repositories WHERE repo_id = $1
            """, repo_id)

            if not row:
                return None

            return self._row_to_repository(row)

    async def get_repositories_by_quality(
        self,
        min_quality_score: float = 50.0,
        limit: int = 100,
        category: Optional[RepositoryCategory] = None
    ) -> List[GitHubRepository]:
        """Get repositories by quality score."""
        async with self.pool.acquire() as conn:
            query = """
                SELECT * FROM github_repositories
                WHERE quality_score >= $1
            """
            params = [min_quality_score]

            if category:
                query += " AND category = $2"
                params.append(category.value)

            query += " ORDER BY quality_score DESC LIMIT $" + str(len(params) + 1)
            params.append(limit)

            rows = await conn.fetch(query, *params)
            return [self._row_to_repository(row) for row in rows]

    async def save_repository_content(self, content: RepositoryContent) -> RepositoryContent:
        """Save repository content analysis."""
        async with self.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO repository_content (
                    repo_id, total_files, code_files, documentation_files, config_files,
                    lines_of_code, cyclomatic_complexity, maintainability_index,
                    has_readme, has_license, has_tests, has_ci_cd, has_documentation,
                    security_issues, vulnerability_count, ghidra_mentions, bsim_mentions,
                    reverse_engineering_keywords, binary_analysis_keywords, analyzed_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                         $14, $15, $16, $17, $18, $19, $20)
                ON CONFLICT (repo_id) DO UPDATE SET
                    total_files = EXCLUDED.total_files,
                    code_files = EXCLUDED.code_files,
                    documentation_files = EXCLUDED.documentation_files,
                    config_files = EXCLUDED.config_files,
                    lines_of_code = EXCLUDED.lines_of_code,
                    cyclomatic_complexity = EXCLUDED.cyclomatic_complexity,
                    maintainability_index = EXCLUDED.maintainability_index,
                    has_readme = EXCLUDED.has_readme,
                    has_license = EXCLUDED.has_license,
                    has_tests = EXCLUDED.has_tests,
                    has_ci_cd = EXCLUDED.has_ci_cd,
                    has_documentation = EXCLUDED.has_documentation,
                    security_issues = EXCLUDED.security_issues,
                    vulnerability_count = EXCLUDED.vulnerability_count,
                    ghidra_mentions = EXCLUDED.ghidra_mentions,
                    bsim_mentions = EXCLUDED.bsim_mentions,
                    reverse_engineering_keywords = EXCLUDED.reverse_engineering_keywords,
                    binary_analysis_keywords = EXCLUDED.binary_analysis_keywords,
                    analyzed_at = EXCLUDED.analyzed_at
            """,
                content.repo_id, content.total_files, content.code_files,
                content.documentation_files, content.config_files, content.lines_of_code,
                content.cyclomatic_complexity, content.maintainability_index,
                content.has_readme, content.has_license, content.has_tests,
                content.has_ci_cd, content.has_documentation, content.security_issues,
                content.vulnerability_count, content.ghidra_mentions, content.bsim_mentions,
                content.reverse_engineering_keywords, content.binary_analysis_keywords,
                content.analyzed_at
            )

        logger.debug("Repository content saved", repo_id=content.repo_id)
        return content

    async def save_mining_task(self, task: MiningTask) -> MiningTask:
        """Save or update a mining task."""
        async with self.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO mining_tasks (
                    task_id, task_type, search_query, repository_id, user_id,
                    priority, max_repositories, include_forks, min_stars,
                    status, progress, repositories_found, repositories_analyzed,
                    high_quality_found, created_at, started_at, completed_at,
                    error_message, retry_count
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                         $13, $14, $15, $16, $17, $18, $19)
                ON CONFLICT (task_id) DO UPDATE SET
                    status = EXCLUDED.status,
                    progress = EXCLUDED.progress,
                    repositories_found = EXCLUDED.repositories_found,
                    repositories_analyzed = EXCLUDED.repositories_analyzed,
                    high_quality_found = EXCLUDED.high_quality_found,
                    started_at = EXCLUDED.started_at,
                    completed_at = EXCLUDED.completed_at,
                    error_message = EXCLUDED.error_message,
                    retry_count = EXCLUDED.retry_count
            """,
                task.task_id, task.task_type, task.search_query,
                task.repository_id, task.user_id, task.priority,
                task.max_repositories, task.include_forks, task.min_stars,
                task.status.value, task.progress, task.repositories_found,
                task.repositories_analyzed, task.high_quality_found,
                task.created_at, task.started_at, task.completed_at,
                task.error_message, task.retry_count
            )

        logger.debug("Mining task saved", task_id=task.task_id, task_type=task.task_type)
        return task

    async def get_pending_tasks(self, limit: int = 10) -> List[MiningTask]:
        """Get pending mining tasks."""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT * FROM mining_tasks
                WHERE status = 'pending'
                ORDER BY priority DESC, created_at ASC
                LIMIT $1
            """, limit)

            return [self._row_to_mining_task(row) for row in rows]

    async def get_mining_statistics(self) -> Dict[str, Any]:
        """Get comprehensive mining statistics."""
        async with self.pool.acquire() as conn:
            # Repository statistics
            repo_stats = await conn.fetchrow("""
                SELECT
                    COUNT(*) as total_repositories,
                    COUNT(*) FILTER (WHERE quality_score >= 70) as high_quality_repositories,
                    AVG(quality_score) as avg_quality_score,
                    AVG(relevance_score) as avg_relevance_score,
                    SUM(stars_count) as total_stars
                FROM github_repositories
            """)

            # Category breakdown
            category_stats = await conn.fetch("""
                SELECT category, COUNT(*) as count
                FROM github_repositories
                GROUP BY category
                ORDER BY count DESC
            """)

            # Language breakdown
            language_stats = await conn.fetch("""
                SELECT primary_language, COUNT(*) as count
                FROM github_repositories
                GROUP BY primary_language
                ORDER BY count DESC
                LIMIT 10
            """)

            # Task statistics
            task_stats = await conn.fetchrow("""
                SELECT
                    COUNT(*) FILTER (WHERE status = 'pending') as pending_tasks,
                    COUNT(*) FILTER (WHERE status = 'in_progress') as active_tasks,
                    COUNT(*) FILTER (WHERE status = 'completed' AND
                                   completed_at >= NOW() - INTERVAL '24 hours') as completed_today
                FROM mining_tasks
            """)

            return {
                "repositories": dict(repo_stats) if repo_stats else {},
                "categories": {row["category"]: row["count"] for row in category_stats},
                "languages": {row["primary_language"]: row["count"] for row in language_stats},
                "tasks": dict(task_stats) if task_stats else {}
            }

    def _row_to_repository(self, row) -> GitHubRepository:
        """Convert database row to GitHubRepository model."""
        return GitHubRepository(
            repo_id=str(row["repo_id"]),
            github_id=row["github_id"],
            full_name=row["full_name"],
            name=row["name"],
            owner=row["owner"],
            description=row["description"],
            homepage=row["homepage"],
            topics=row["topics"] or [],
            language=row["language"],
            primary_language=RepositoryLanguage(row["primary_language"]),
            stars_count=row["stars_count"],
            forks_count=row["forks_count"],
            watchers_count=row["watchers_count"],
            issues_count=row["issues_count"],
            size_kb=row["size_kb"],
            is_fork=row["is_fork"],
            is_archived=row["is_archived"],
            is_private=row["is_private"],
            has_wiki=row["has_wiki"],
            has_pages=row["has_pages"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            pushed_at=row["pushed_at"],
            category=RepositoryCategory(row["category"]),
            relevance_score=row["relevance_score"],
            quality_score=row["quality_score"],
            quality_grade=QualityScore(row["quality_grade"]),
            discovered_at=row["discovered_at"],
            last_analyzed=row["last_analyzed"],
            mining_status=MiningStatus(row["mining_status"])
        )

    def _row_to_mining_task(self, row) -> MiningTask:
        """Convert database row to MiningTask model."""
        return MiningTask(
            task_id=str(row["task_id"]),
            task_type=row["task_type"],
            search_query=row["search_query"],
            repository_id=str(row["repository_id"]) if row["repository_id"] else None,
            user_id=str(row["user_id"]) if row["user_id"] else None,
            priority=row["priority"],
            max_repositories=row["max_repositories"],
            include_forks=row["include_forks"],
            min_stars=row["min_stars"],
            status=MiningStatus(row["status"]),
            progress=row["progress"],
            repositories_found=row["repositories_found"],
            repositories_analyzed=row["repositories_analyzed"],
            high_quality_found=row["high_quality_found"],
            created_at=row["created_at"],
            started_at=row["started_at"],
            completed_at=row["completed_at"],
            error_message=row["error_message"],
            retry_count=row["retry_count"]
        )


# Global database instance
github_db = GitHubMiningDatabase()