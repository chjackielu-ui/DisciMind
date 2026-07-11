-- AlterTable: Add new WorkflowNodeType enum values for multimodal and LangGraph support
ALTER TABLE `learning_session_node_runs`
  MODIFY COLUMN `node_type` enum(
    'concept_explanation',
    'analogy_explanation',
    'worked_example_analysis',
    'socratic_questioning',
    'basic_practice',
    'adaptive_practice',
    'wrong_question_repair',
    'mastery_gate',
    'learning_summary',
    'multimodal_interaction',
    'diagnostic_pre_test',
    'deep_evaluation',
    'variant_question',
    'misconception_repair',
    'summary'
  ) NOT NULL;
