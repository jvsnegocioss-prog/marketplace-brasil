"use strict";

function escapePostgrestLikePattern(value) {
  if (typeof value !== "string") return "";
  // Escape PostgreSQL LIKE metacharacters and PostgREST's * wildcard alias.
  return value.replace(/[\\%_*]/g, "\\$&");
}

module.exports = { escapePostgrestLikePattern };
