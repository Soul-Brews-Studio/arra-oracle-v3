CREATE VIRTUAL TABLE IF NOT EXISTS oracle_fts USING fts5(
	id UNINDEXED,
	content,
	concepts,
	tokenize='porter unicode61'
);
