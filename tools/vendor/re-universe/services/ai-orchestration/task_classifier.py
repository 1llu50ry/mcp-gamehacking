"""Task classification and intelligent model routing for AI orchestration."""

import re
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass

from models import (
    TaskComplexity, TaskType, ModelType, OrchestrationRequest, TaskClassification
)
from config import settings
from logging_config import get_logger

logger = get_logger(__name__)


@dataclass
class RequestCharacteristics:
    """Characteristics extracted from a request for routing decisions."""
    token_count: int
    mentions_ghidra_workflow: bool
    is_batch_operation: bool
    requires_quality_validation: bool
    involves_multiple_systems: bool
    user_query_complexity: str
    has_code_analysis: bool
    requires_documentation: bool
    is_strategic_decision: bool


class TaskClassifier:
    """Analyzes incoming requests and routes to optimal model."""

    # Routing rules based on proven patterns
    ROUTING_RULES = {
        ModelType.OPUS: {
            'triggers': [
                'quality_validation_required',
                'multi_system_coordination',
                'strategic_planning',
                'cost_optimization_decision',
                'complex_chat_orchestration'
            ],
            'keywords': [
                'validate', 'verify', 'quality', 'strategic', 'plan workflow',
                'coordinate', 'optimize', 'decision', 'architecture', 'complex analysis'
            ],
            'complexity_threshold': 0.8,
            'token_threshold': 2000
        },

        ModelType.SONNET: {
            'triggers': [
                'ghidra_workflow_execution',
                'complex_function_analysis',
                'documentation_generation',
                'system_discovery',
                'knowledge_verification'
            ],
            'keywords': [
                'function_doc_workflow', 'plate_comment', 'analyze function',
                'generate documentation', 'system architecture', 'cross-reference',
                'decompile', 'reverse engineering', 'binary analysis'
            ],
            'complexity_threshold': 0.5,
            'token_threshold': 500
        },

        ModelType.HAIKU: {
            'triggers': [
                'batch_operations',
                'template_processing',
                'entity_extraction',
                'simple_classifications',
                'progress_reporting'
            ],
            'keywords': [
                'rename', 'batch', 'label', 'extract', 'classify', 'list',
                'hungarian notation', 'snake_case', 'template', 'generate labels'
            ],
            'complexity_threshold': 0.3,
            'token_threshold': 100
        }
    }

    # Workflow-specific routing
    WORKFLOW_ROUTING = {
        'FUNCTION_DOC_WORKFLOW_V4': {
            'initialize_and_analyze': ModelType.SONNET,
            'mandatory_type_audit': ModelType.SONNET,
            'control_flow_mapping': ModelType.SONNET,
            'structure_identification': ModelType.SONNET,
            'function_naming_and_prototype': ModelType.SONNET,
            'variable_renaming': ModelType.HAIKU,
            'global_data_renaming': ModelType.HAIKU,
            'plate_comment_creation': ModelType.SONNET,
            'inline_comments': ModelType.HAIKU,
            'validation_and_completion': ModelType.OPUS
        }
    }

    def __init__(self):
        self.token_counter = self._setup_token_counter()

    def _setup_token_counter(self):
        """Setup token counting functionality."""
        # Simple token estimation - can be replaced with more accurate counting
        return lambda text: len(text.split()) * 1.3  # Rough approximation

    async def classify_request(
        self,
        request: OrchestrationRequest,
        context: Optional[Dict] = None
    ) -> TaskClassification:
        """Classify request complexity and route to appropriate model."""

        try:
            # Analyze request characteristics
            characteristics = self._analyze_characteristics(request)

            # Apply routing rules
            classification = self._apply_routing_rules(request, characteristics)

            # Apply workflow-specific routing if applicable
            if request.workflow_type:
                classification = self._apply_workflow_routing(request, classification, characteristics)

            # Apply budget constraints
            classification = await self._apply_budget_constraints(classification)

            # Log classification decision
            logger.info("Request classified",
                       request_id=request.request_id,
                       recommended_model=classification.recommended_model.value,
                       complexity=classification.complexity.value,
                       task_type=classification.task_type.value,
                       confidence=classification.confidence,
                       estimated_cost=classification.estimated_cost)

            return classification

        except Exception as e:
            logger.error("Classification failed", request_id=request.request_id, error=str(e))

            # Fallback to safe default
            return TaskClassification(
                complexity=TaskComplexity.MODERATE,
                task_type=TaskType.ANALYSIS,
                recommended_model=ModelType.HAIKU,
                confidence=0.1,
                reasoning=f"Classification failed, using fallback: {str(e)}",
                estimated_cost=0.01,
                estimated_time=30.0,
                requires_fallback=True
            )

    def _analyze_characteristics(self, request: OrchestrationRequest) -> RequestCharacteristics:
        """Extract key characteristics that influence routing decisions."""

        prompt_lower = request.prompt.lower()
        context_text = ""
        if request.context:
            context_text = str(request.context).lower()

        combined_text = f"{prompt_lower} {context_text}"

        return RequestCharacteristics(
            token_count=int(self.token_counter(request.prompt)),
            mentions_ghidra_workflow=any(
                workflow in combined_text
                for workflow in ['function_doc_workflow', 'plate_comment', 'hungarian_notation', 'ghidra']
            ),
            is_batch_operation=any(
                term in combined_text
                for term in ['batch', 'rename all', 'process multiple', 'bulk']
            ),
            requires_quality_validation=any(
                term in combined_text
                for term in ['validate', 'verify', 'check quality', 'review']
            ),
            involves_multiple_systems=self._count_system_references(combined_text) > 1,
            user_query_complexity=self._assess_query_complexity(request.prompt),
            has_code_analysis=any(
                term in combined_text
                for term in ['analyze function', 'decompile', 'reverse engineer', 'binary analysis']
            ),
            requires_documentation=any(
                term in combined_text
                for term in ['document', 'comment', 'explain', 'describe function']
            ),
            is_strategic_decision=any(
                term in combined_text
                for term in ['plan', 'strategy', 'architecture', 'design', 'coordinate']
            )
        )

    def _count_system_references(self, text: str) -> int:
        """Count references to different systems in the text."""
        systems = ['ghidra', 'bsim', 'vector search', 'database', 'redis', 'api']
        return sum(1 for system in systems if system in text)

    def _assess_query_complexity(self, prompt: str) -> str:
        """Assess the complexity of the user query."""
        # Simple complexity heuristics
        if len(prompt) < 50:
            return "simple"
        elif len(prompt) < 200:
            return "moderate"
        elif any(word in prompt.lower() for word in ['complex', 'detailed', 'comprehensive', 'analyze']):
            return "complex"
        elif prompt.count('?') > 2 or prompt.count('.') > 5:
            return "complex"
        else:
            return "moderate"

    def _apply_routing_rules(
        self,
        request: OrchestrationRequest,
        characteristics: RequestCharacteristics
    ) -> TaskClassification:
        """Apply routing rules based on request characteristics."""

        # Check for preferred model override
        if request.preferred_model and settings.enable_model_routing:
            return self._create_classification_for_model(
                request.preferred_model, characteristics, "User preference override"
            )

        # Score each model based on characteristics
        model_scores = {}

        for model, rules in self.ROUTING_RULES.items():
            score = 0.0

            # Keyword matching
            keyword_matches = sum(
                1 for keyword in rules['keywords']
                if keyword in request.prompt.lower()
            )
            score += keyword_matches * 0.3

            # Complexity matching
            if characteristics.user_query_complexity == "complex" and model == ModelType.OPUS:
                score += 0.4
            elif characteristics.user_query_complexity == "moderate" and model == ModelType.SONNET:
                score += 0.3
            elif characteristics.user_query_complexity == "simple" and model == ModelType.HAIKU:
                score += 0.2

            # Token count considerations
            if characteristics.token_count >= rules['token_threshold']:
                if model in [ModelType.OPUS, ModelType.SONNET]:
                    score += 0.2
            else:
                if model == ModelType.HAIKU:
                    score += 0.2

            # Special characteristics
            if characteristics.mentions_ghidra_workflow and model == ModelType.SONNET:
                score += 0.5
            if characteristics.is_batch_operation and model == ModelType.HAIKU:
                score += 0.4
            if characteristics.requires_quality_validation and model == ModelType.OPUS:
                score += 0.4
            if characteristics.is_strategic_decision and model == ModelType.OPUS:
                score += 0.5

            model_scores[model] = score

        # Select best model
        best_model = max(model_scores, key=model_scores.get)
        confidence = min(1.0, model_scores[best_model])

        # Determine task type and complexity
        task_type = self._determine_task_type(characteristics)
        complexity = self._determine_complexity(characteristics, best_model)

        return TaskClassification(
            complexity=complexity,
            task_type=task_type,
            recommended_model=best_model,
            confidence=confidence,
            reasoning=f"Selected based on routing rules. Score: {model_scores[best_model]:.2f}",
            estimated_cost=self._estimate_cost(best_model, characteristics.token_count),
            estimated_time=self._estimate_time(best_model, task_type),
            requires_fallback=confidence < 0.5,
            batch_eligible=characteristics.is_batch_operation
        )

    def _determine_task_type(self, characteristics: RequestCharacteristics) -> TaskType:
        """Determine the primary task type based on characteristics."""
        if characteristics.is_batch_operation:
            return TaskType.BATCH
        elif characteristics.requires_quality_validation:
            return TaskType.VALIDATION
        elif characteristics.mentions_ghidra_workflow:
            return TaskType.WORKFLOW
        elif characteristics.requires_documentation:
            return TaskType.GENERATION
        elif characteristics.is_strategic_decision:
            return TaskType.COORDINATION
        else:
            return TaskType.ANALYSIS

    def _determine_complexity(self, characteristics: RequestCharacteristics, model: ModelType) -> TaskComplexity:
        """Determine task complexity."""
        complexity_score = 0

        if characteristics.user_query_complexity == "complex":
            complexity_score += 2
        elif characteristics.user_query_complexity == "moderate":
            complexity_score += 1

        if characteristics.mentions_ghidra_workflow:
            complexity_score += 1
        if characteristics.involves_multiple_systems:
            complexity_score += 1
        if characteristics.requires_quality_validation:
            complexity_score += 1
        if characteristics.token_count > 1000:
            complexity_score += 1

        if complexity_score >= 3:
            return TaskComplexity.COMPLEX
        elif complexity_score >= 1:
            return TaskComplexity.MODERATE
        else:
            return TaskComplexity.SIMPLE

    def _apply_workflow_routing(
        self,
        request: OrchestrationRequest,
        base_classification: TaskClassification,
        characteristics: RequestCharacteristics
    ) -> TaskClassification:
        """Apply workflow-specific routing rules."""

        if request.workflow_type in self.WORKFLOW_ROUTING:
            workflow_steps = self.WORKFLOW_ROUTING[request.workflow_type]

            # Try to identify specific workflow step from context
            if request.context and 'step' in request.context:
                step_name = request.context['step']
                if step_name in workflow_steps:
                    recommended_model = workflow_steps[step_name]

                    return TaskClassification(
                        complexity=base_classification.complexity,
                        task_type=TaskType.WORKFLOW,
                        recommended_model=recommended_model,
                        confidence=0.9,
                        reasoning=f"Workflow-specific routing for {request.workflow_type}:{step_name}",
                        estimated_cost=self._estimate_cost(recommended_model, characteristics.token_count),
                        estimated_time=self._estimate_time(recommended_model, TaskType.WORKFLOW),
                        requires_fallback=False,
                        batch_eligible=step_name in ['variable_renaming', 'global_data_renaming']
                    )

        return base_classification

    async def _apply_budget_constraints(self, classification: TaskClassification) -> TaskClassification:
        """Apply budget constraints to model selection."""
        # This would integrate with the cost manager
        # For now, implement basic cost-aware routing

        if classification.estimated_cost > 0.1:  # High cost threshold
            # Consider downgrading model
            if classification.recommended_model == ModelType.OPUS:
                logger.info("Considering model downgrade due to cost",
                           original_model=ModelType.OPUS.value,
                           estimated_cost=classification.estimated_cost)

                # Downgrade to Sonnet if confidence allows
                if classification.confidence >= 0.7:
                    classification.recommended_model = ModelType.SONNET
                    classification.estimated_cost = self._estimate_cost(
                        ModelType.SONNET,
                        int(classification.estimated_time * 10)  # Rough token estimate
                    )
                    classification.reasoning += " (Downgraded from Opus for cost efficiency)"

        return classification

    def _create_classification_for_model(
        self,
        model: ModelType,
        characteristics: RequestCharacteristics,
        reasoning: str
    ) -> TaskClassification:
        """Create a classification for a specific model."""

        return TaskClassification(
            complexity=self._determine_complexity(characteristics, model),
            task_type=self._determine_task_type(characteristics),
            recommended_model=model,
            confidence=0.8,
            reasoning=reasoning,
            estimated_cost=self._estimate_cost(model, characteristics.token_count),
            estimated_time=self._estimate_time(model, self._determine_task_type(characteristics)),
            requires_fallback=False,
            batch_eligible=characteristics.is_batch_operation
        )

    def _estimate_cost(self, model: ModelType, token_count: int) -> float:
        """Estimate the cost for a model and token count."""
        # Rough cost estimation
        cost_per_1k = {
            ModelType.OPUS: 0.045,    # Average of input/output
            ModelType.SONNET: 0.009,  # Average of input/output
            ModelType.HAIKU: 0.0006   # Average of input/output
        }

        base_cost = (token_count / 1000) * cost_per_1k.get(model, 0.01)

        # Add buffer for output tokens (typically 30% of input)
        total_cost = base_cost * 1.3

        return round(total_cost, 6)

    def _estimate_time(self, model: ModelType, task_type: TaskType) -> float:
        """Estimate processing time in seconds."""
        base_times = {
            ModelType.OPUS: 45.0,
            ModelType.SONNET: 25.0,
            ModelType.HAIKU: 8.0
        }

        task_multipliers = {
            TaskType.ANALYSIS: 1.0,
            TaskType.GENERATION: 1.5,
            TaskType.BATCH: 0.7,
            TaskType.COORDINATION: 2.0,
            TaskType.VALIDATION: 1.2,
            TaskType.WORKFLOW: 1.3
        }

        base_time = base_times.get(model, 30.0)
        multiplier = task_multipliers.get(task_type, 1.0)

        return base_time * multiplier