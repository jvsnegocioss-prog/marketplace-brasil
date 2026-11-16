const test = require("node:test");
const assert = require("node:assert/strict");
const { getOwnedReviewMediaPaths } = require("../lib/review-media-security.cjs");

const base = "https://project.supabase.co";

test("seleciona somente arquivos do bucket e da pasta do próprio usuário", () => {
  assert.deepEqual(getOwnedReviewMediaPaths([
    "https://project.supabase.co/storage/v1/object/public/products-media/reviews/user-1/photo.jpg",
    "https://project.supabase.co/storage/v1/object/public/products-media/reviews/user-2/photo.jpg",
    "https://project.supabase.co/storage/v1/object/public/other/reviews/user-1/photo.jpg",
    "https://cdn.example.com/reviews/user-1/photo.jpg",
  ], "user-1", base), ["reviews/user-1/photo.jpg"]);
});

test("ignora URLs inválidas, caminhos de traversal e entradas não textuais", () => {
  assert.deepEqual(getOwnedReviewMediaPaths([
    null,
    42,
    "not a url",
    "https://project.supabase.co/storage/v1/object/public/products-media/reviews/user-1/../other.jpg",
    "https://project.supabase.co/storage/v1/object/public/products-media/reviews/user-2/photo.jpg",
  ], "user-1", base), []);
});

test("remove duplicatas e falha fechada quando a URL do projeto é inválida", () => {
  const url = "https://project.supabase.co/storage/v1/object/public/products-media/reviews/user-1/photo.webp";
  assert.deepEqual(getOwnedReviewMediaPaths([url, url], "user-1", base), [
    "reviews/user-1/photo.webp",
  ]);
  assert.deepEqual(getOwnedReviewMediaPaths([url], "user-1", "invalid"), []);
});
