const test = require("node:test");
const assert = require("node:assert/strict");
const { getOwnedReviewMediaPaths, isReviewMediaPath } = require("../lib/review-media-security.cjs");

const user1 = "11111111-1111-4111-8111-111111111111";
const user2 = "22222222-2222-4222-8222-222222222222";
const file1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const file2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("aceita somente caminhos no formato privado reviews/{userId}/{uuid}.{ext}", () => {
  assert.equal(isReviewMediaPath(`reviews/${user1}/${file1}.jpg`), true);
  assert.equal(isReviewMediaPath(`reviews/${user1}/${file2}.webm`), true);
  assert.equal(isReviewMediaPath(`reviews/${user1}/photo.jpg`), false);
  assert.equal(isReviewMediaPath(`https://project.supabase.co/storage/v1/object/public/products-media/reviews/${user1}/${file1}.jpg`), false);
});

test("seleciona somente arquivos pertencentes ao próprio usuário e remove duplicatas", () => {
  const owned = `reviews/${user1}/${file1}.jpg`;
  assert.deepEqual(getOwnedReviewMediaPaths([
    owned,
    owned,
    `reviews/${user2}/${file2}.jpg`,
    `reviews/${user1}/${file2}.exe`,
    `reviews/${user1}/../${file2}.jpg`,
    null,
    42,
  ], user1), [owned]);
});

test("falha fechada para listas ou usuários inválidos", () => {
  assert.deepEqual(getOwnedReviewMediaPaths("not-an-array", user1), []);
  assert.deepEqual(getOwnedReviewMediaPaths([`reviews/${user1}/${file1}.jpg`], ""), []);
});
