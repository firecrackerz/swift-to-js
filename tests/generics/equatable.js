export function equal$lhs$rhs$(T, lhs, rhs) {
  return T.Equatable.$equals$(lhs, rhs);
}
const $Int$Type = {
  Equatable: {
    $equals$(lhs, rhs) {
      return lhs === rhs;
    },

    $notequals$(lhs, rhs) {
      return lhs !== rhs;
    },

    $match$(lhs, rhs) {
      return lhs === rhs;
    }

  }
};
export function integerEqual$lhs$rhs$(lhs, rhs) {
  return equal$lhs$rhs$($Int$Type, lhs, rhs);
}
const $Double$question$$Type = {
  Equatable: {
    $equals$(lhs, rhs) {
      return lhs === rhs;
    },

    $notequals$(lhs, rhs) {
      return lhs !== rhs;
    },

    $match$(lhs, rhs) {
      return lhs === rhs;
    }

  }
};
export function optionalDoubleEqual$lhs$rhs$(lhs, rhs) {
  return equal$lhs$rhs$($Double$question$$Type, lhs, rhs);
}
const $$String$$Type = {
  Equatable: {
    $equals$(lhs, rhs) {
      let equal;

      if (lhs.length !== rhs.length) {
        equal = false;
      } else {
        let i = 0;

        while (i < lhs.length && lhs[i] === rhs[i]) {
          i++;
        }

        equal = i === lhs.length;
      }

      return equal;
    },

    $notequals$(lhs, rhs) {
      let unequal;

      if (lhs.length !== rhs.length) {
        unequal = true;
      } else {
        let i = 0;

        while (i < lhs.length && lhs[i] === rhs[i]) {
          i++;
        }

        unequal = i !== lhs.length;
      }

      return unequal;
    },

    $match$(lhs, rhs) {
      let equal;

      if (lhs.length !== rhs.length) {
        equal = false;
      } else {
        let i = 0;

        while (i < lhs.length && lhs[i] === rhs[i]) {
          i++;
        }

        equal = i === lhs.length;
      }

      return equal;
    }

  }
};
export function stringArrayEqual$lhs$rhs$(lhs, rhs) {
  return equal$lhs$rhs$($$String$$Type, lhs, rhs);
}
const $Point$Type = {
  Equatable: {
    $equals$(lhs, rhs) {
      return lhs.x === rhs.x && lhs.y === rhs.y;
    },

    $notequals$(lhs, rhs) {
      return !(lhs.x === rhs.x && lhs.y === rhs.y);
    },

    $match$(lhs, rhs) {
      return lhs.x === rhs.x && lhs.y === rhs.y;
    }

  }
};
export function pointEqual$lhs$rhs$(lhs, rhs) {
  return equal$lhs$rhs$($Point$Type, lhs, rhs);
}
export function pointEqualDirect$lhs$rhs$(lhs, rhs) {
  return lhs.x === rhs.x && lhs.y === rhs.y;
}
export function pointNotEqualDirect$lhs$rhs$(lhs, rhs) {
  return !(lhs.x === rhs.x && lhs.y === rhs.y);
}
const $$Point$$Type = {
  Equatable: {
    $equals$(lhs, rhs) {
      let equal;

      if (lhs.length !== rhs.length) {
        equal = false;
      } else {
        let i = 0;

        while (i < lhs.length && function () {
          const lhs = lhs[i];
          const rhs = rhs[i];
          return lhs.x === rhs.x && lhs.y === rhs.y;
        }()) {
          i++;
        }

        equal = i === lhs.length;
      }

      return equal;
    },

    $notequals$(lhs, rhs) {
      let unequal;

      if (lhs.length !== rhs.length) {
        unequal = true;
      } else {
        let i = 0;

        while (i < lhs.length && function () {
          const lhs = lhs[i];
          const rhs = rhs[i];
          return lhs.x === rhs.x && lhs.y === rhs.y;
        }()) {
          i++;
        }

        unequal = i !== lhs.length;
      }

      return unequal;
    },

    $match$(lhs, rhs) {
      let equal;

      if (lhs.length !== rhs.length) {
        equal = false;
      } else {
        let i = 0;

        while (i < lhs.length && function () {
          const lhs = lhs[i];
          const rhs = rhs[i];
          return lhs.x === rhs.x && lhs.y === rhs.y;
        }()) {
          i++;
        }

        equal = i === lhs.length;
      }

      return equal;
    }

  }
};
export function pointArrayEqual$lhs$rhs$(lhs, rhs) {
  return equal$lhs$rhs$($$Point$$Type, lhs, rhs);
}