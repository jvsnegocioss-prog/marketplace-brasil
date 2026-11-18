"use strict";

function isValidTrackingPhone(value) {
  if (typeof value !== "string") return false;
  const digits = value.replace(/[^0-9]/g, "");
  return digits.length >= 10 && digits.length <= 13;
}

module.exports = { isValidTrackingPhone };
