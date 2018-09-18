export function makeSizes$w1$h1$w2$h2$(w1, h1, w2, h2) {
  return [function () {
    const size = new Size();
    size.width = w1;
    size.height = h1;
    return size;
  }(), function () {
    const size0 = new Size();
    size0.width = w2;
    size0.height = h2;
    return size0;
  }()];
}
export function sumSizes$sizes$(sizes) {
  const w = sizes[0].width + sizes[1].height;
  const h = sizes[0].height + sizes[1].height;
  return function () {
    const size1 = new Size();
    size1.width = w;
    size1.height = h;
    return size1;
  }();
}
export function copySizes$sizes$(sizes) {
  return sizes.slice();
}
export class Size {}