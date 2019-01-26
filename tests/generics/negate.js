export function negate$number$(T, number) {
  return T.SignedNumeric.$minus$(T, number);
}
const $Int$Type = {
  AdditiveArithmetic: {
    $plus$(Self, lhs, rhs) {
      return lhs + rhs;
    },

    $minus$(Self, lhs, rhs) {
      return lhs - rhs;
    },

    zero(Self) {
      return 0;
    }

  },
  BinaryInteger: {
    $mod$(Self, lhs, rhs) {
      return lhs % rhs;
    },

    $and$(Self, lhs, rhs) {
      return lhs & rhs;
    },

    $multiply$(Self, lhs, rhs) {
      return lhs * rhs;
    },

    $plus$(Self, lhs, rhs) {
      return lhs + rhs;
    },

    $minus$(Self, lhs, rhs) {
      return lhs - rhs;
    },

    $divide$(Self, lhs, rhs) {
      return lhs / rhs | 0;
    },

    $less$(Self, lhs, rhs) {
      return lhs < rhs;
    },

    $leftshift$(Self, lhs, rhs) {
      return lhs << rhs;
    },

    $lessequal$(Self, lhs, rhs) {
      return lhs <= rhs;
    },

    $greater$(Self, lhs, rhs) {
      return lhs > rhs;
    },

    $greaterequal$(Self, lhs, rhs) {
      return lhs >= rhs;
    },

    $rightshift$(Self, lhs, rhs) {
      return lhs >> rhs;
    },

    $xor$(Self, lhs, rhs) {
      return lhs ^ rhs;
    },

    init$clamping$(Self, T, value) {
      return value > T.SignedInteger.max(T) ? T.SignedInteger.max(T) : value < T.SignedInteger.min(T) ? T.SignedInteger.min(T) : value;
    },

    init$exactly$(Self, T, value) {
      return value > T.SignedInteger.min(T) || value < T.SignedInteger.max(T) ? null : value;
    },

    init$truncatingIfNeeded$(Self, source) {
      return source | 0;
    },

    isSigned(Self) {
      return true;
    },

    quotientAndRemainder$dividingBy$(Self, lhs, rhs) {
      return [lhs / rhs | 0, lhs % rhs];
    },

    signum(Self, self) {
      return self > 0 ? 1 : self < 0 ? -1 : self;
    },

    $or$(Self, lhs, rhs) {
      return lhs | rhs;
    },

    $tilde$(Self, self) {
      return ~self;
    }

  },
  Comparable: {
    $$$(Self, minimum, maximum) {
      return [minimum, maximum];
    },

    $less$(Self, lhs, rhs) {
      return lhs < rhs;
    },

    $lessequal$(Self, lhs, rhs) {
      return lhs <= rhs;
    },

    $greater$(Self, lhs, rhs) {
      return lhs > rhs;
    },

    $greaterequal$(Self, lhs, rhs) {
      return lhs >= rhs;
    }

  },
  CustomStringConvertible: {
    description(Self, self) {
      return String(self);
    }

  },
  Equatable: {
    $notequals$(Self, lhs, rhs) {
      return lhs !== rhs;
    },

    $equals$(Self, lhs, rhs) {
      return lhs === rhs;
    }

  },
  FixedWidthInteger: {
    $and$$multiply$(Self, lhs, rhs) {
      return lhs * rhs | 0;
    },

    $and$$plus$(Self, lhs, rhs) {
      return lhs + rhs | 0;
    },

    $and$$minus$(Self, lhs, rhs) {
      return lhs - rhs | 0;
    },

    $and$$leftshift$(Self, lhs, rhs) {
      return lhs << rhs;
    },

    $and$$leftshift$$equal$(Self, lhs, rhs) {
      lhs[0] = lhs[0] << rhs;
    },

    $and$$rightshift$(Self, lhs, rhs) {
      return lhs >> rhs;
    },

    $and$$rightshift$$equal$(Self, lhs, rhs) {
      lhs[0] = lhs[0] >> rhs;
    },

    addingReportingOverflow(Self, lhs, rhs) {
      const full = lhs + rhs;
      const truncated = full | 0;
      return [truncated, truncated !== full];
    },

    bigEndian(Self, value) {
      return value >> 24 & 255 | value >> 8 & 65280 | value << 8 & 16711680 | value << 24;
    },

    bitWidth(Self) {
      return 32;
    },

    byteSwapped(Self, value) {
      return value >> 24 & 255 | value >> 8 & 65280 | value << 8 & 16711680 | value << 24;
    },

    dividedReportingOverflow$by$(Self, lhs, rhs) {
      const full = lhs / rhs | 0;
      const truncated = full | 0;
      return [truncated, truncated !== full];
    },

    dividingFullWidth(Self) {
      return $$notImplemented();
    },

    init$radix$(Self, text, radix) {
      const integer = parseInt(text, radix);
      return integer !== integer ? null : integer;
    },

    init$bigEndian$(Self, value) {
      return value >> 24 & 255 | value >> 8 & 65280 | value << 8 & 16711680 | value << 24;
    },

    init$clamping$(Self, $1) {
      return $1 > $1.SignedInteger.max($1) ? $1.SignedInteger.max($1) : $1 < $1.SignedInteger.min($1) ? $1.SignedInteger.min($1) : $1;
    },

    init$littleEndian$(Self, value) {
      return value;
    },

    leadingZeroBitCount(Self, value) {
      let shift = 32;

      while (value >> --shift === 0 && shift >= 0) {}

      return 31 - shift;
    },

    littleEndian(Self, self) {
      return self;
    },

    max(Self) {
      return 2147483647;
    },

    min(Self) {
      return -2147483648;
    },

    multipliedFullWidth$by$(Self, lhs, rhs) {
      return [lhs * rhs / 4294967296 | 0, Math.imul(lhs, rhs)];
    },

    multipliedReportingOverflow$by$(Self, lhs, rhs) {
      const full = lhs * rhs;
      const truncated = full | 0;
      return [truncated, truncated !== full];
    },

    nonzeroBitCount(Self, value) {
      let current = value;
      let count = 0;

      while (current) {
        count++;
        current &= current - 1;
      }

      return count;
    },

    remainderReportingOverflow$dividingBy$(Self, lhs, rhs) {
      const full = lhs % rhs;
      const truncated = full | 0;
      return [truncated, truncated !== full];
    },

    subtractingReportingOverflow(Self, lhs, rhs) {
      const full = lhs - rhs;
      const truncated = full | 0;
      return [truncated, truncated !== full];
    }

  },
  Hashable: {
    hash$into$(Self, self, hasher) {
      hasher[0] = (hasher[0] << 5) + self - hasher[0];
    },

    hashValue(Self, self) {
      return self;
    }

  },
  LosslessStringConvertible: {
    init(Self, description) {
      const integer = parseInt(description, 10);
      return integer !== integer ? null : integer;
    }

  },
  Numeric: {
    $multiply$(Self, lhs, rhs) {
      return lhs * rhs;
    },

    init$exactly$(Self, T, value) {
      return value > T.SignedInteger.min(T) || value < T.SignedInteger.max(T) ? null : value;
    }

  },
  Object: {
    $rep(Self) {
      return 4;
    }

  },
  SignedInteger: {
    $and$$plus$(Self, lhs, rhs) {
      return lhs + rhs | 0;
    },

    $and$$minus$(Self, lhs, rhs) {
      return lhs - rhs | 0;
    },

    init(Self, T, value) {
      return value < T.SignedInteger.min(T) || value > T.SignedInteger.max(T) ? $$numericRangeFailed() : value;
    },

    init$exactly$(Self, T, value) {
      return value > T.SignedInteger.min(T) || value < T.SignedInteger.max(T) ? null : value;
    },

    max(Self) {
      return 2147483647;
    },

    min(Self) {
      return -2147483648;
    }

  },
  SignedNumeric: {
    $minus$(Self, value) {
      return -value;
    },

    negate(Self, self) {
      self[0] = -self[0];
    }

  },
  Strideable: {
    $plus$(Self, lhs, rhs) {
      return lhs + rhs;
    },

    $minus$(Self, lhs, rhs) {
      return lhs - rhs;
    },

    $$$(Self, start, end) {
      return [start, end];
    },

    $equals$(Self, lhs, rhs) {
      return lhs === rhs;
    },

    advanced$by$(Self, lhs, rhs) {
      return lhs + rhs;
    },

    distance$to$(Self, lhs, rhs) {
      return rhs - lhs;
    }

  }
};

function $$notImplemented() {
  throw new Error("Not implemented!");
}

function $$numericRangeFailed() {
  throw new RangeError("Not enough bits to represent the given value");
}

export function negate$integer$(integer) {
  return negate$number$($Int$Type, integer);
}
const $Double$Type = {
  Equatable: {
    $notequals$(Self, lhs, rhs) {
      return lhs !== rhs;
    },

    $equals$(Self, lhs, rhs) {
      return lhs === rhs;
    }

  },
  FloatingPoint: {
    $notequals$(Self, lhs, rhs) {
      return lhs !== rhs;
    },

    $multiply$: abstract$Double$$multiply$,
    $plus$: abstract$Double$$plus$,
    $minus$: abstract$Double$$minus$,
    $divide$: abstract$Double$$divide$,

    $equals$(Self, lhs, rhs) {
      return lhs === rhs;
    },

    addProduct: abstract$Double$addProduct,
    addingProduct: abstract$Double$addingProduct,
    exponent: abstract$Double$exponent,
    floatingPointClass: abstract$Double$floatingPointClass,
    formRemainder$dividingBy$: abstract$Double$formRemainder$dividingBy$,
    formSquareRoot: abstract$Double$formSquareRoot,
    formTruncatingRemainder$dividingBy$: abstract$Double$formTruncatingRemainder$dividingBy$,
    greatestFiniteMagnitude: abstract$Double$greatestFiniteMagnitude,
    infinity: abstract$Double$infinity,
    init: abstract$Double$init,
    isCanonical: abstract$Double$isCanonical,
    isEqual$to$: abstract$Double$isEqual$to$,
    isFinite: abstract$Double$isFinite,
    isInfinite: abstract$Double$isInfinite,
    isLess$than$: abstract$Double$isLess$than$,
    isLessThanOrEqualTo: abstract$Double$isLessThanOrEqualTo,
    isNaN: abstract$Double$isNaN,
    isSignalingNaN: abstract$Double$isSignalingNaN,
    isSubnormal: abstract$Double$isSubnormal,
    isTotallyOrdered$belowOrEqualTo$: abstract$Double$isTotallyOrdered$belowOrEqualTo$,
    isZero: abstract$Double$isZero,
    leastNonzeroMagnitude: abstract$Double$leastNonzeroMagnitude,
    leastNormalMagnitude: abstract$Double$leastNormalMagnitude,
    maximum: abstract$Double$maximum,
    maximumMagnitude: abstract$Double$maximumMagnitude,
    minimum: abstract$Double$minimum,
    minimumMagnitude: abstract$Double$minimumMagnitude,
    nan: abstract$Double$nan,
    negate: abstract$Double$negate,
    nextDown: abstract$Double$nextDown,
    nextUp: abstract$Double$nextUp,
    pi: abstract$Double$pi,
    radix: abstract$Double$radix,
    remainder$dividingBy$: abstract$Double$remainder$dividingBy$,
    round: abstract$Double$round,
    round: abstract$Double$round,
    rounded: abstract$Double$rounded,
    rounded: abstract$Double$rounded,
    sign: abstract$Double$sign,
    signalingNaN: abstract$Double$signalingNaN,
    significand: abstract$Double$significand,

    squareRoot() {
      return Math.sqrt($Double$Type);
    },

    truncatingRemainder$dividingBy$: abstract$Double$truncatingRemainder$dividingBy$,
    ulp: abstract$Double$ulp,
    ulpOfOne: abstract$Double$ulpOfOne
  },
  LosslessStringConvertible: {
    init(Self, description) {
      const number = Number(description);
      return number === number ? null : number;
    }

  },
  Object: {
    $rep(Self) {
      return 4;
    }

  },
  SignedNumeric: {
    $minus$(Self, value) {
      return -value;
    },

    negate(Self, self) {
      self[0] = -self[0];
    }

  }
};
export function negate$double$(double) {
  return negate$number$($Double$Type, double);
}
export function negateDirect$double$(double) {
  return -double;
}