function actualPageNumber(metadata) {
  const value = metadata?.page_number ?? metadata?.page ?? null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

module.exports = { actualPageNumber };
