-- Smart-answering questions must always store the canonical answer as JSON.
UPDATE `questions`
SET `correct_answer` = JSON_OBJECT('type', 'unknown', 'answer', JSON_ARRAY())
WHERE `correct_answer` IS NULL;

ALTER TABLE `questions`
  MODIFY `correct_answer` JSON NOT NULL;
