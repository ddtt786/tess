extern "wasm" fn f64_load(offset : Int) -> Double =
  #|(func (param i32) (result f64) (f64.load (local.get 0)))

extern "wasm" fn f64_store(offset : Int, value : Double) =
  #|(func (param i32) (param f64) (f64.store (local.get 0) (local.get 1)))

// `ln` and `acos` are the two the wasm maths library rounds differently from
// the page's `Math`, so the host answers those itself and every work agrees.
fn host_ln(x : Double) -> Double = "tess" "ln"

fn host_acos(x : Double) -> Double = "tess" "acos"

///| Reads slot i of the shared region.
fn ld(i : Int) -> Double {
  f64_load(1024 + i * 8)
}

///| Writes slot i of the shared region.
fn st(i : Int, v : Double) -> Unit {
  f64_store(1024 + i * 8, v)
}

///| Entry reads a list item by a one-based index and any other index as 0.
fn ld_item(base : Int, length : Int, index : Double) -> Double {
  if index != index.trunc() || index < 1.0 || index > length.to_double() {
    return 0.0
  }
  ld(base + index.to_int() - 1)
}

///| The tail kept beside a table the kernel only reads. An index outside the
///| list answers 0, which is the tail of the 0 the value itself answers with.
fn ld_tail(base : Int, length : Int, index : Double) -> Int {
  ld_item(base, length, index).to_int()
}

///| `listReplace` — an index outside the list leaves it alone.
fn st_item(base : Int, length : Int, index : Double, v : Double) -> Unit {
  if index != index.trunc() || index < 1.0 || index > length.to_double() {
    return
  }
  st(base + index.to_int() - 1, v)
}

let tens : FixedArray[Double] = [
  1.0, 1.0e1, 1.0e2, 1.0e3, 1.0e4, 1.0e5, 1.0e6, 1.0e7, 1.0e8, 1.0e9, 1.0e10,
  1.0e11, 1.0e12, 1.0e13, 1.0e14, 1.0e15, 1.0e16, 1.0e17, 1.0e18, 1.0e19,
  1.0e20, 1.0e21,
]

///| Counted decimals stop here; `snap` refuses to round anything this long.
const DECIMAL_CAP = 21

///| Decimals beyond this cannot be recovered by rounding.
const MAX_DECIMALS = 20

///| Above this the decimal grid is finer than the gap between neighbouring
///| doubles, so rounding onto it and reading back lands on the same double.
const EXACT_LIMIT = 9007199254740992.0

///| `2 ** 27 + 1` — Dekker's splitting constant for a double.
const SPLIT = 134217729.0

///| `|a|` rounded onto the `places` grid, half away from zero, exactly.
///| Only called where `a * tens[places]` is below `EXACT_LIMIT`, so the integer
///| it lands on is one a double holds and the division below is exact.
fn grid_round(a : Double, places : Int) -> Double {
  let ten = tens[places]
  let scaled = a * ten
  let split_a = SPLIT * a
  let high_a = split_a - (split_a - a)
  let low_a = a - high_a
  let split_ten = SPLIT * ten
  let high_ten = split_ten - (split_ten - ten)
  let low_ten = ten - high_ten
  let error = high_a * high_ten - scaled + high_a * low_ten + low_a * high_ten +
    low_a * low_ten
  let mut rounded = scaled.floor()
  // `frac - 0.5` is exact wherever the decision is close, so the residual is
  // added to that difference rather than to `frac`, which would absorb it.
  if scaled - rounded - 0.5 + error >= 0.0 {
    rounded = rounded + 1.0
  }
  rounded
}

///| Whether `|a|` written with `places` decimals reads back as the same double.
fn reads_back(a : Double, places : Int) -> Bool {
  let ten = tens[places]
  if a * ten >= EXACT_LIMIT {
    return true
  }
  grid_round(a, places) / ten == a
}

///| Digits after the decimal point in `a`, searched only below `limit`, which
///| the caller has already found the tail to fit inside.
fn decimals_below(a : Double, limit : Int) -> Int {
  // A shorter tail reads back at every longer one, so the shortest is a search.
  let mut low = 1
  let mut high = limit
  while low < high {
    let middle = (low + high) / 2
    if reads_back(a, middle) {
      high = middle
    } else {
      low = middle + 1
    }
  }
  low
}

///| Digits after the decimal point in a double's shortest representation.
pub fn decimals(x : Double) -> Int {
  if x.trunc() == x && x - x == 0.0 {
    return 0
  }
  decimals_below(x.abs(), DECIMAL_CAP)
}

///| The shortest tail `snap` could still round `a` onto. At and above it the
///| decimal grid is finer than the gap between neighbouring doubles, so
///| rounding a result onto that grid gives the result back unchanged.
///|
///| The answer only moves with the size of `a`, so the exponent it is written
///| with picks it out and a single test settles the one step of slack a binade
///| leaves. A search over the powers of ten costs five of those tests.
fn grid_wall(a : Double) -> Int {
  let mut low = 0
  let mut high = DECIMAL_CAP
  while low < high {
    let middle = (low + high) / 2
    if a * tens[middle] >= EXACT_LIMIT {
      high = middle
    } else {
      low = middle + 1
    }
  }
  if a * tens[low] >= EXACT_LIMIT {
    low
  } else {
    DECIMAL_CAP + 1
  }
}

///| The decimals of one operand, or `DECIMAL_CAP` once its tail reaches `wall`.
///| Asking whether the tail is long enough costs a fraction of reading it, and
///| in a work built on trigonometry it nearly always is.
fn tail_of(x : Double, wall : Int) -> Int {
  if x.trunc() == x && x - x == 0.0 {
    return 0
  }
  let a = x.abs()
  let below = wall - 1
  if reads_back(a, below) {
    decimals_below(a, below)
  } else {
    DECIMAL_CAP
  }
}

///| `max(decimals(a), decimals(b))`, told only as far as `snap` can use it.
///| `ta`·`tb` carry a tail the caller already knows — a literal's, which the
///| compiler counted once — and -1 where it does not.
fn max_tail(result : Double, a : Double, b : Double, ta : Int, tb : Int) -> Int {
  let wall = grid_wall(result.abs())
  if wall <= 1 {
    return DECIMAL_CAP
  }
  let left = if ta >= 0 { ta } else { tail_of(a, wall) }
  if left >= wall {
    return DECIMAL_CAP
  }
  let right = if tb >= 0 { tb } else { tail_of(b, wall) }
  if right >= wall {
    return DECIMAL_CAP
  }
  if left > right {
    left
  } else {
    right
  }
}

///| `decimals(a) + decimals(b)`, told only as far as `snap` can use it.
fn sum_tail(result : Double, a : Double, b : Double, ta : Int, tb : Int) -> Int {
  let wall = grid_wall(result.abs())
  if wall <= 1 {
    return DECIMAL_CAP
  }
  let left = if ta >= 0 { ta } else { tail_of(a, wall) }
  if left >= wall {
    return DECIMAL_CAP
  }
  let right = if tb >= 0 { tb } else { tail_of(b, wall) }
  if right >= wall || left + right >= wall {
    return DECIMAL_CAP
  }
  left + right
}

///| Rounds a sum or product back onto the decimal grid its operands imply.
pub fn snap(result : Double, places : Int) -> Double {
  if places == 0 || places > MAX_DECIMALS || result - result != 0.0 {
    return result
  }
  let a = if result < 0.0 { -result } else { result }
  let ten = tens[places]
  if a * ten >= EXACT_LIMIT {
    return result
  }
  let out = grid_round(a, places) / ten
  if result < 0.0 {
    -out
  } else if out == 0.0 {
    // `(-0).toFixed(n)` writes "0.00", so a negative zero comes back positive.
    0.0
  } else {
    out
  }
}

///| `+` on numbers. Entry adds in decimal, so `0.1 + 0.2` is `0.3`.
pub fn add_num(a : Double, b : Double, ta : Int, tb : Int) -> Double {
  let r = a + b
  if a.trunc() == a && b.trunc() == b && a - a == 0.0 && b - b == 0.0 {
    return r
  }
  snap(r, max_tail(r, a, b, ta, tb))
}

///| `-` on numbers.
pub fn sub_num(a : Double, b : Double, ta : Int, tb : Int) -> Double {
  let r = a - b
  if a.trunc() == a && b.trunc() == b && a - a == 0.0 && b - b == 0.0 {
    return r
  }
  snap(r, max_tail(r, a, b, ta, tb))
}

///| `*` on numbers.
pub fn mul_num(a : Double, b : Double, ta : Int, tb : Int) -> Double {
  let r = a * b
  if a.trunc() == a && b.trunc() == b && a - a == 0.0 && b - b == 0.0 {
    return r
  }
  snap(r, sum_tail(r, a, b, ta, tb))
}

///| `/` on numbers. Entry divides to 20 decimal places before reading the double.
pub fn div_num(a : Double, b : Double) -> Double {
  let r = a / b
  if r == 0.0 || r - r != 0.0 {
    return r
  }
  let m = if r < 0.0 { -r } else { r }
  if m >= 1.0e-3 || m * tens[MAX_DECIMALS] >= EXACT_LIMIT {
    return r
  }
  let out = grid_round(m, MAX_DECIMALS) / tens[MAX_DECIMALS]
  if r < 0.0 {
    -out
  } else if out == 0.0 {
    0.0
  } else {
    out
  }
}

///| The decimal modulo entryjs installs, whose result carries the divisor's sign.
pub fn mod_num(value : Double, divisor : Double, tv : Int, td : Int) -> Double {
  let once = value % divisor
  let r = (once + divisor) % divisor
  if value.trunc() == value &&
    divisor.trunc() == divisor &&
    value - value == 0.0 &&
    divisor - divisor == 0.0 {
    return r
  }
  snap(r, max_tail(r, value, divisor, tv, td))
}

///| `Entry.Scope.getNumberValue` — `parseFloat` and then 0 for anything that is
///| not a number. A double is already parsed, so what is left is that `NaN` and
///| `-0` both fall to 0, which every number slot of a block relies on.
pub fn to_num(x : Double) -> Double {
  if x != x || x == 0.0 {
    0.0
  } else {
    x
  }
}

///| `Entry.Scope.getBooleanValue` — `NaN` does not parse, so it reads as true.
pub fn truthy(x : Double) -> Bool {
  if x != x {
    true
  } else {
    x != 0.0
  }
}

///| `Boolean(value)`, which `boolean_and_or` uses and where `NaN` is false.
pub fn js_bool(x : Double) -> Bool {
  x != 0.0 && x == x
}

///| `andOf`/`orOf` — entry reads both sides before combining them.
pub fn both(a : Bool, b : Bool, is_and : Bool) -> Bool {
  if is_and {
    a && b
  } else {
    a || b
  }
}

///| Marks the run as one the caller must throw away and redo in javascript.
pub fn bail() -> Unit {
  st(0, 1.0)
}

///| `maxFloatPoint` for one value — digits after the dot of `String(value)`.
///| Entry counts the characters, so the exponent of a short number counts too.
pub fn float_point(x : Double) -> Double {
  let a = x.abs()
  if (a >= 1.0e-6 && a < 1.0e21) || x == 0.0 {
    let d = decimals(x)
    return (if d > 20 { 20 } else { d }).to_double()
  }
  // Written with an exponent, which only happens far from the values a work
  // counts with; the text itself answers it there.
  let s = x.to_string()
  let n = s.length()
  let mut dot = -1
  for i = 0; i < n; i = i + 1 {
    if s.unsafe_get(i) == 46 {
      dot = i
    }
  }
  if dot < 0 {
    return 0.0
  }
  let count = n - dot - 1
  (if count > 20 { 20 } else { count }).to_double()
}

const PI = 3.141592653589793

let sqrt3 : Double = 1.7320508075688772

let half_sqrt2 : Double = 0.7071067811865476

///| Entry answers the whole degrees of the unit circle from a table.
fn trig_table(angle : Double, op : Int) -> Double {
  // op: 0 sin, 1 cos, 2 tan. A miss comes back as NaN.
  let nan = (0.0 : Double) / 0.0
  let a = angle
  if a != a.trunc() {
    return nan
  }
  let k = a.to_int()
  if k % 15 != 0 || k < -360 || k > 360 {
    return nan
  }
  match op {
    0 =>
      match k {
        0 | 180 | 360 => 0.0
        30 | 150 => 0.5
        45 | 135 => half_sqrt2
        60 | 120 => sqrt3 / 2.0
        90 => 1.0
        210 | 330 => -0.5
        225 | 315 => -half_sqrt2
        240 | 300 => -sqrt3 / 2.0
        270 => -1.0
        _ => nan
      }
    1 =>
      match k {
        0 | 360 => 1.0
        30 | 330 => sqrt3 / 2.0
        45 | 315 => half_sqrt2
        60 | 300 => 0.5
        90 | 270 => 0.0
        120 | 240 => -0.5
        135 | 225 => -half_sqrt2
        150 | 210 => -sqrt3 / 2.0
        180 => -1.0
        _ => nan
      }
    _ =>
      match k {
        0 | 180 | 360 => 0.0
        30 | 210 => sqrt3 / 3.0
        45 | 225 => 1.0
        60 | 240 => sqrt3
        90 => @double.infinity
        120 | 300 => -sqrt3
        135 | 315 => -1.0
        150 | 330 => -sqrt3 / 3.0
        270 => @double.neg_infinity
        _ => nan
      }
  }
}

///| `sin`·`cos`·`tan` in degrees, the exact turns answered from the table.
fn precise_trig(degrees : Double, op : Int) -> Double {
  let angle = degrees % 360.0
  let exact = trig_table(angle, op)
  if exact == exact {
    return exact
  }
  let radians = angle * PI / 180.0
  match op {
    0 => @math.sin(radians)
    1 => @math.cos(radians)
    _ => @math.tan(radians)
  }
}

///| `n!`, multiplied out the way entry does.
fn factorial(n : Double) -> Double {
  let mut result = 1.0
  let mut i = 2.0
  while i <= n {
    result = result * i
    i = i + 1.0
  }
  result
}

///| `calc_operation` — the operator is an index the emitter picks at compile time.
pub fn math_op(value : Double, op : Int) -> Double {
  match op {
    0 => value * value
    1 => factorial(value)
    2 => value.sqrt()
    3 => host_ln(value) / 2.302585092994046
    4 => host_ln(value)
    5 => @math.asin(value) * 180.0 / PI
    6 => host_acos(value) * 180.0 / PI
    7 => @math.atan(value) * 180.0 / PI
    8 => precise_trig(value, 0)
    9 => precise_trig(value, 1)
    10 => precise_trig(value, 2)
    11 => {
      let fraction = sub_num(value, value.floor(), -1, 0)
      if value < 0.0 && fraction != 0.0 {
        1.0 - fraction
      } else {
        fraction
      }
    }
    12 => value.abs()
    13 => value.floor()
    14 => value.ceil()
    _ => js_round(value)
  }
}

///| `Math.round` — half goes up, towards positive infinity.
pub fn js_round(value : Double) -> Double {
  let down = value.floor()
  let up = if value - down >= 0.5 { down + 1.0 } else { down }
  // `Math.round` keeps the sign of a value that rounds to zero.
  if up == 0.0 && (value < 0.0 || 1.0 / value < 0.0) {
    -0.0
  } else {
    up
  }
}

///| `quotient_and_mod`.
pub fn quotient(left : Double, right : Double, remainder : Bool) -> Double {
  let share = (left / right).floor()
  if remainder {
    left - right * share
  } else {
    share
  }
}
