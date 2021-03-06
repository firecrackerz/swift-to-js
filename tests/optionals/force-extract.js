function $$forceUnwrapFailed() {
  throw new TypeError("Unexpectedly found nil while unwrapping an Optional value");
}

export function force_unwrap$option$(option) {
  return option !== null ? option : $$forceUnwrapFailed();
}
export function force_unwrap$doubleOption$(option) {
  return option.length !== 0 ? option[0] : $$forceUnwrapFailed();
}
export function force_unwrap$allTheWay$(option) {
  const optional = option.length !== 0 ? option[0] : $$forceUnwrapFailed();
  return optional !== null ? optional : $$forceUnwrapFailed();
}