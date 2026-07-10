-- Bind a reusable learning-flow template to an optional knowledge point.
-- Existing templates remain valid and can still be selected for any course.
ALTER TABLE `learning_workflow_templates`
  ADD COLUMN `knowledge_point_id` INTEGER NULL;

CREATE INDEX `learning_workflow_templates_knowledge_point_id_idx`
  ON `learning_workflow_templates`(`knowledge_point_id`);

ALTER TABLE `learning_workflow_templates`
  ADD CONSTRAINT `learning_workflow_templates_knowledge_point_id_fkey`
  FOREIGN KEY (`knowledge_point_id`) REFERENCES `knowledge_points`(`knowledge_point_id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
