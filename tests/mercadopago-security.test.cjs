  for (const invalid of [
    null,
    { data: [] },
    { data: {}, paging: { total: 0, limit: 10, offset: 0 } },
    { data: [], paging: { total: -1, limit: 10, offset: 0 } },
    { data: [], paging: { total: 1, limit: 0, offset: 0 } },
    { data: [], paging: { total: 1, limit: 10, offset: 2 } },
    { data: [{ id: "1" }, { id: "2" }], paging: { total: 1, limit: 1, offset: 0 } },
    { data: [], paging: { total: 2, limit: 10, offset: 0 } },
    { data: [], paging: { total: 1, limit: 10, offset: 0.5 } },
  ]) {
    assert.equal(readOrderSearchPage(invalid).status, "invalid_response");
    assert.equal(readOrderSearchPage(invalid).nextOffset, null);
  }
});


test("reconciliação exige todas as páginas em sequência antes de selecionar Order", () => {
  const reference = "123e4567-e89b-12d3-a456-426614174000";
  const pages = [
    { data: [{ id: "other", external_reference: "123e4567-e89b-12d3-a456-426614174001" }], paging: { total: 2, limit: 1, offset: 0 } },
    { data: [{ id: "order-200", external_reference: reference }], paging: { total: 2, limit: 1, offset: 1 } },
  ];
  assert.deepEqual(selectUniqueOrderAcrossSearchPages(pages, reference), {
    status: "matched", order: pages[1].data[0],
  });
  assert.deepEqual(selectUniqueOrderAcrossSearchPages([pages[0]], reference), { status: "invalid_response", order: null });
  assert.deepEqual(selectUniqueOrderAcrossSearchPages([pages[1], pages[0]], reference), { status: "invalid_response", order: null });
  assert.deepEqual(selectUniqueOrderAcrossSearchPages([
    pages[0], { ...pages[1], paging: { ...pages[1].paging, total: 3 } },
  ], reference), { status: "invalid_response", order: null });
  assert.deepEqual(selectUniqueOrderAcrossSearchPages([
    pages[0], { ...pages[1], data: [{ id: "order-201", external_reference: reference }] },
  ], reference), { status: "matched", order: { id: "order-201", external_reference: reference } });
  const duplicated = [
    { data: [{ id: "order-200", external_reference: reference }], paging: { total: 2, limit: 1, offset: 0 } },
    { data: [{ id: "order-201", external_reference: reference }], paging: { total: 2, limit: 1, offset: 1 } },
  ];
  assert.deepEqual(selectUniqueOrderAcrossSearchPages(duplicated, reference), { status: "ambiguous", order: null });
  assert.deepEqual(selectUniqueOrderAcrossSearchPages([], reference), { status: "invalid_response", order: null });
});
  for (const invalid of [
    null,
    { data: [] },
    { data: {}, paging: { total: 0, limit: 10, offset: 0 } },
    { data: [], paging: { total: -1, limit: 10, offset: 0 } },
    { data: [], paging: { total: 1, limit: 0, offset: 0 } },
    { data: [], paging: { total: 1, limit: 10, offset: 2 } },
    { data: [{ id: "1" }, { id: "2" }], paging: { total: 1, limit: 1, offset: 0 } },
    { data: [], paging: { total: 2, limit: 10, offset: 0 } },
    { data: [], paging: { total: 1, limit: 10, offset: 0.5 } },
  ]) {
    assert.equal(readOrderSearchPage(invalid).status, "invalid_response");
    assert.equal(readOrderSearchPage(invalid).nextOffset, null);
  }
});


test("reconciliação exige todas as páginas em sequência antes de selecionar Order", () => {
  const reference = "123e4567-e89b-12d3-a456-426614174000";
  const pages = [
    { data: [{ id: "other", external_reference: "123e4567-e89b-12d3-a456-426614174001" }], paging: { total: 2, limit: 1, offset: 0 } },
    { data: [{ id: "order-200", external_reference: reference }], paging: { total: 2, limit: 1, offset: 1 } },
  ];
  assert.deepEqual(selectUniqueOrderAcrossSearchPages(pages, reference), {
    status: "matched", order: pages[1].data[0],
  });
  assert.deepEqual(selectUniqueOrderAcrossSearchPages([pages[0]], reference), { status: "invalid_response", order: null });
  assert.deepEqual(selectUniqueOrderAcrossSearchPages([pages[1], pages[0]], reference), { status: "invalid_response", order: null });
  assert.deepEqual(selectUniqueOrderAcrossSearchPages([
    pages[0], { ...pages[1], paging: { ...pages[1].paging, total: 3 } },
  ], reference), { status: "invalid_response", order: null });
  assert.deepEqual(selectUniqueOrderAcrossSearchPages([
    pages[0], { ...pages[1], data: [{ id: "order-201", external_reference: reference }] },
  ], reference), { status: "matched", order: { id: "order-201", external_reference: reference } });
  const duplicated = [
    { data: [{ id: "order-200", external_reference: reference }], paging: { total: 2, limit: 1, offset: 0 } },
    { data: [{ id: "order-201", external_reference: reference }], paging: { total: 2, limit: 1, offset: 1 } },
  ];
  assert.deepEqual(selectUniqueOrderAcrossSearchPages(duplicated, reference), { status: "ambiguous", order: null });
  assert.deepEqual(selectUniqueOrderAcrossSearchPages([], reference), { status: "invalid_response", order: null });
});
  // Formato oficial documentado: "data" e metadados de paginação em strings.
  assert.deepEqual(readOrderSearchPage({
    data: [{ id: "order-docs" }],
    paging: { total: "1", total_pages: "1", offset: "0", limit: "20" },
  }), {
    status: "valid", orders: [{ id: "order-docs" }], nextOffset: null, total: 1, offset: 0,
  });
