// ============================================================================
//  Tess 시맨틱: 파스 트리(CST) -> AST 변환
//
//  문법(tess.ohm)은 "이 코드가 올바른가" 만 판단하고,
//  "그래서 이게 무슨 뜻인가" 는 전부 이 파일이 담당한다.
// ============================================================================
import { grammar } from './grammar.js';

const semantics = grammar.createSemantics();

/** 노드가 소비한 입력 구간 */
const at = (node) => ({ start: node.source.startIdx, end: node.source.endIdx });

/** 자식들을 모두 ast() 로 변환한 배열 */
const list = (iterNode) => iterNode.children.map((c) => c.ast());

/** ListOf<x, ","> 처럼 내장 리스트 규칙을 배열로 */
const items = (listNode) => listNode.asIteration().children.map((c) => c.ast());

/** 선택적(?) 노드: 있으면 변환, 없으면 null */
const opt = (optNode) => optNode.child(0)?.ast() ?? null;

const ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };

semantics.addOperation('ast', {
  // ==========================================================================
  //  프로그램 · 선언
  // ==========================================================================
  Program(body) {
    return { type: 'Program', body: list(body), loc: at(this) };
  },

  UseDecl(_use, path) {
    return { type: 'Use', path: path.ast().value, loc: at(this) };
  },
  UseObjectDecl_object(_kw, path) {
    return { type: 'UseObject', kind: 'object', path: path.ast().value, loc: at(this) };
  },
  UseObjectDecl_text(_kw, path) {
    return { type: 'UseObject', kind: 'text', path: path.ast().value, loc: at(this) };
  },

  ProjectDecl(_project, _open, fields, _end) {
    return { type: 'Project', fields: list(fields), loc: at(this) };
  },
  ProjectField_title(_kw, value) {
    return { type: 'ProjectField', field: 'title', value: value.ast(), loc: at(this) };
  },
  ProjectField_description(_kw, value) {
    return { type: 'ProjectField', field: 'description', value: value.ast(), loc: at(this) };
  },
  ProjectField_fps(_kw, value) {
    return { type: 'ProjectField', field: 'fps', value: value.ast(), loc: at(this) };
  },

  SceneFragment(members) {
    return list(members);
  },
  ObjectFragment(members) {
    return list(members);
  },

  SceneDecl(_scene, name, _open, members, _end) {
    return { type: 'Scene', name: name.ast().value, body: list(members), loc: at(this) };
  },
  // 오브젝트의 PropertyDecl_name 과 같은 모양(type: 'Property')으로 만들어서
  // 컴파일러가 오브젝트 이름 처리와 똑같은 방식으로 다룰 수 있게 한다.
  SceneNameDecl(_name, value) {
    return { type: 'Property', name: 'name', value: value.ast(), loc: at(this) };
  },

  ObjectDecl(_object, name, _open, members, _end) {
    return { type: 'Object', kind: 'object', name: name.ast().value, body: list(members), loc: at(this) };
  },
  TextDecl(_text, name, _open, members, _end) {
    return { type: 'Object', kind: 'text', name: name.ast().value, body: list(members), loc: at(this) };
  },

  // --- 오브젝트 속성 --------------------------------------------------------
  PropertyDecl_defaultCostumeSized(_default, _costume, id, file, _size, width, height) {
    return costume(this, id, file, true, width, height);
  },
  PropertyDecl_defaultCostume(_default, _costume, id, file) {
    return costume(this, id, file, true, null, null);
  },
  PropertyDecl_costumeSized(_costume, id, file, _size, width, height) {
    return costume(this, id, file, false, width, height);
  },
  PropertyDecl_costume(_costume, id, file) {
    return costume(this, id, file, false, null, null);
  },
  PropertyDecl_rotation(_rotation, method) {
    return { type: 'Property', name: 'rotation', value: { type: 'Keyword', name: method.sourceString }, loc: at(this) };
  },
  PropertyDecl_soundLength(_sound, id, file, _for, duration) {
    return {
      type: 'Sound',
      id: id.ast().name,
      file: file.ast().value,
      duration: duration.ast().value,
      loc: at(this),
    };
  },
  PropertyDecl_sound(_sound, id, file) {
    return { type: 'Sound', id: id.ast().name, file: file.ast().value, duration: null, loc: at(this) };
  },
  PropertyDecl_name(_name, value) {
    return { type: 'Property', name: 'name', value: value.ast(), loc: at(this) };
  },
  PropertyDecl_visible(_visible, value) {
    return { type: 'Property', name: 'visible', value: value.ast(), loc: at(this) };
  },
  PropertyDecl_lock(_lock, value) {
    return { type: 'Property', name: 'lock', value: value.ast(), loc: at(this) };
  },
  PropertyDecl_assign(name, _eq, value) {
    return { type: 'Property', name: name.sourceString, value: value.ast(), loc: at(this) };
  },

  // --- 함수 · 변수 · 리스트 --------------------------------------------------
  FunctionDecl(_fn, name, _lp, params, _rp, _open, body, _end) {
    return {
      type: 'FunctionDecl',
      name: name.ast().name,
      params: items(params).map((p) => p.name),
      body: body.ast(),
      loc: at(this),
    };
  },
  VarDecl(_var, name, _eq, value) {
    return { type: 'VarDecl', name: name.ast().name, value: value.ast(), loc: at(this) };
  },
  ListDecl(_list, name, _eq, value) {
    return { type: 'ListDecl', name: name.ast().name, value: value.ast(), loc: at(this) };
  },

  // ==========================================================================
  //  이벤트
  // ==========================================================================
  EventHandler_sceneStart(_when, _scene, _start, _open, body, _end) {
    return { type: 'Event', event: 'scene_start', body: body.ast(), loc: at(this) };
  },
  EventHandler_start(_when, _start, _open, body, _end) {
    return { type: 'Event', event: 'start', body: body.ast(), loc: at(this) };
  },
  EventHandler_keyUp(_when, _key, key, _up, _open, body, _end) {
    return { type: 'Event', event: 'key_up', key: key.ast().value, body: body.ast(), loc: at(this) };
  },
  EventHandler_key(_when, _key, key, _open, body, _end) {
    return { type: 'Event', event: 'key', key: key.ast().value, body: body.ast(), loc: at(this) };
  },
  EventHandler_stageClickUp(_when, _stage, _click, _up, _open, body, _end) {
    return { type: 'Event', event: 'stage_click_up', body: body.ast(), loc: at(this) };
  },
  EventHandler_stageClick(_when, _stage, _click, _open, body, _end) {
    return { type: 'Event', event: 'stage_click', body: body.ast(), loc: at(this) };
  },
  EventHandler_clickUp(_when, _click, _up, _open, body, _end) {
    return { type: 'Event', event: 'click_up', body: body.ast(), loc: at(this) };
  },
  EventHandler_click(_when, _click, _open, body, _end) {
    return { type: 'Event', event: 'click', body: body.ast(), loc: at(this) };
  },
  EventHandler_signal(_when, _signal, name, _open, body, _end) {
    return { type: 'Event', event: 'signal', signal: name.ast().value, body: body.ast(), loc: at(this) };
  },
  EventHandler_cloned(_when, _cloned, _open, body, _end) {
    return { type: 'Event', event: 'cloned', body: body.ast(), loc: at(this) };
  },

  // ==========================================================================
  //  제어 흐름
  // ==========================================================================
  Block(statements) {
    return list(statements);
  },

  IfStatement_ifElse(_if, test, _o1, consequent, _else, _o2, alternate, _end) {
    return {
      type: 'If',
      test: test.ast(),
      consequent: consequent.ast(),
      alternate: alternate.ast(),
      loc: at(this),
    };
  },
  IfStatement_if(_if, test, _open, consequent, _end) {
    return { type: 'If', test: test.ast(), consequent: consequent.ast(), alternate: null, loc: at(this) };
  },

  RepeatStatement(_repeat, count, _open, body, _end) {
    return { type: 'Repeat', count: count.ast(), body: body.ast(), loc: at(this) };
  },
  WhileStatement(_while, test, _open, body, _end) {
    return { type: 'While', test: test.ast(), body: body.ast(), loc: at(this) };
  },
  UntilStatement(_until, test, _open, body, _end) {
    return { type: 'Until', test: test.ast(), body: body.ast(), loc: at(this) };
  },
  ForeverStatement(_forever, _open, body, _end) {
    return { type: 'Forever', body: body.ast(), loc: at(this) };
  },

  WaitStatement(_wait, value) {
    return { type: 'Wait', value: value.ast(), loc: at(this) };
  },
  FlowStatement_break(_kw) {
    return { type: 'Break', loc: at(this) };
  },
  FlowStatement_skip(_kw) {
    return { type: 'Skip', loc: at(this) };
  },
  FlowStatement_restart(_kw) {
    return { type: 'Restart', loc: at(this) };
  },
  ReturnStatement(_return, value) {
    return { type: 'Return', value: value.ast(), loc: at(this) };
  },

  StopStatement_soundThis(_stop, _sound, _this) {
    return { type: 'StopSound', target: 'this', loc: at(this) };
  },
  StopStatement_soundAll(_stop, _sound, _all) {
    return { type: 'StopSound', target: 'all', loc: at(this) };
  },
  StopStatement_draw(_stop, _draw) {
    return { type: 'StopDraw', loc: at(this) };
  },
  StopStatement_fill(_stop, _fill) {
    return { type: 'StopFill', loc: at(this) };
  },
  StopStatement_bgm(_stop, _bgm) {
    return { type: 'StopBgm', loc: at(this) };
  },
  StopStatement_timer(_stop, _timer) {
    return { type: 'StopTimer', loc: at(this) };
  },
  StopStatement_other(_stop, _kw) {
    return { type: 'Stop', target: 'other', loc: at(this) };
  },
  StopStatement_me(_stop, _kw) {
    return { type: 'Stop', target: 'me', loc: at(this) };
  },
  StopStatement_them(_stop, _kw) {
    return { type: 'Stop', target: 'them', loc: at(this) };
  },
  StopStatement_all(_stop, _kw) {
    return { type: 'Stop', target: 'all', loc: at(this) };
  },
  StopStatement_script(_stop) {
    return { type: 'Stop', target: 'this', loc: at(this) };
  },

  StartStatement_draw(_start, _draw) {
    return { type: 'StartDraw', loc: at(this) };
  },
  StartStatement_fill(_start, _fill) {
    return { type: 'StartFill', loc: at(this) };
  },
  StartStatement_timer(_start, _timer) {
    return { type: 'StartTimer', loc: at(this) };
  },

  ResetStatement_size(_reset, _size) {
    return { type: 'ResetSize', loc: at(this) };
  },
  ResetStatement_timer(_reset, _timer) {
    return { type: 'ResetTimer', loc: at(this) };
  },

  ClearStatement_effects(_clear, _kw) {
    return { type: 'Clear', target: 'effects', loc: at(this) };
  },
  ClearStatement_bubble(_clear, _kw) {
    return { type: 'Clear', target: 'bubble', loc: at(this) };
  },
  ClearStatement_draw(_clear, _kw) {
    return { type: 'Clear', target: 'draw', loc: at(this) };
  },
  ClearStatement_text(_clear, _kw) {
    return { type: 'Clear', target: 'text', loc: at(this) };
  },

  // ==========================================================================
  //  신호 · 복제 · 장면
  // ==========================================================================
  SignalStatement_send(_send, name) {
    return { type: 'Send', signal: name.ast(), wait: false, loc: at(this) };
  },
  SignalStatement_call(_call, name) {
    return { type: 'Send', signal: name.ast(), wait: true, loc: at(this) };
  },

  CloneStatement_target(_clone, _sameLine, target) {
    return { type: 'Clone', target: target.ast(), loc: at(this) };
  },
  CloneStatement_self(_clone) {
    return { type: 'Clone', target: null, loc: at(this) };
  },

  DeleteStatement_clones(_del, _clones) {
    return { type: 'DeleteClones', loc: at(this) };
  },
  DeleteStatement_clone(_del, _clone) {
    return { type: 'DeleteClone', loc: at(this) };
  },
  DeleteStatement_kill(_kill) {
    return { type: 'DeleteClone', loc: at(this) };
  },

  JumpStatement_next(_jump, _next) {
    return { type: 'Jump', target: 'next', loc: at(this) };
  },
  JumpStatement_back(_jump, _back) {
    return { type: 'Jump', target: 'back', loc: at(this) };
  },
  JumpStatement_named(_jump, name) {
    return { type: 'Jump', target: name.ast(), loc: at(this) };
  },

  // ==========================================================================
  //  움직임
  // ==========================================================================
  MoveStatement_forwardAt(_forward, distance, _at, angle) {
    return { type: 'Forward', distance: distance.ast(), angle: angle.ast(), loc: at(this) };
  },
  MoveStatement_forward(_forward, distance) {
    return { type: 'Forward', distance: distance.ast(), angle: null, loc: at(this) };
  },
  MoveStatement_bounce(_bounce) {
    return { type: 'Bounce', loc: at(this) };
  },
  MoveStatement_moveIn(_move, dx, _sl, dy, _in, duration) {
    return { type: 'Move', x: dx.ast(), y: dy.ast(), duration: duration.ast(), loc: at(this) };
  },
  MoveStatement_move(_move, dx, _sl, dy) {
    return { type: 'Move', x: dx.ast(), y: dy.ast(), duration: null, loc: at(this) };
  },
  MoveStatement_goPointIn(_go, gx, _sl, gy, _in, duration) {
    return { type: 'Go', x: gx.ast(), y: gy.ast(), target: null, duration: duration.ast(), loc: at(this) };
  },
  MoveStatement_goPoint(_go, gx, _sl, gy) {
    return { type: 'Go', x: gx.ast(), y: gy.ast(), target: null, duration: null, loc: at(this) };
  },
  MoveStatement_goTargetIn(_go, target, _in, duration) {
    return { type: 'Go', x: null, y: null, target: target.ast(), duration: duration.ast(), loc: at(this) };
  },
  MoveStatement_goTarget(_go, target) {
    return { type: 'Go', x: null, y: null, target: target.ast(), duration: null, loc: at(this) };
  },

  RotateStatement_turnIn(_turn, angle, _in, duration) {
    return { type: 'Turn', angle: angle.ast(), duration: duration.ast(), loc: at(this) };
  },
  RotateStatement_turn(_turn, angle) {
    return { type: 'Turn', angle: angle.ast(), duration: null, loc: at(this) };
  },
  RotateStatement_steerIn(_steer, angle, _in, duration) {
    return { type: 'Steer', angle: angle.ast(), duration: duration.ast(), loc: at(this) };
  },
  RotateStatement_steer(_steer, angle) {
    return { type: 'Steer', angle: angle.ast(), duration: null, loc: at(this) };
  },
  RotateStatement_look(_look, target) {
    return { type: 'Look', target: target.ast(), loc: at(this) };
  },

  // ==========================================================================
  //  모양 · 대화
  // ==========================================================================
  LooksStatement_showTarget(_show, _sameLine, target) {
    return { type: 'Show', target: target.ast(), loc: at(this) };
  },
  LooksStatement_show(_show) {
    return { type: 'Show', target: null, loc: at(this) };
  },
  LooksStatement_hideTarget(_hide, _sameLine, target) {
    return { type: 'Hide', target: target.ast(), loc: at(this) };
  },
  LooksStatement_hide(_hide) {
    return { type: 'Hide', target: null, loc: at(this) };
  },
  LooksStatement_nextCostume(_next, _costume) {
    return { type: 'CostumeStep', direction: 'next', loc: at(this) };
  },
  LooksStatement_prevCostume(_prev, _costume) {
    return { type: 'CostumeStep', direction: 'prev', loc: at(this) };
  },
  LooksStatement_sayFor(_say, message, _for, duration) {
    return { type: 'Say', message: message.ast(), duration: duration.ast(), loc: at(this) };
  },
  LooksStatement_say(_say, message) {
    return { type: 'Say', message: message.ast(), duration: null, loc: at(this) };
  },
  LooksStatement_thinkFor(_think, message, _for, duration) {
    return { type: 'Think', message: message.ast(), duration: duration.ast(), loc: at(this) };
  },
  LooksStatement_think(_think, message) {
    return { type: 'Think', message: message.ast(), duration: null, loc: at(this) };
  },
  LooksStatement_flipX(_flip, _x) {
    return { type: 'Flip', axis: 'x', loc: at(this) };
  },
  LooksStatement_flipY(_flip, _y) {
    return { type: 'Flip', axis: 'y', loc: at(this) };
  },
  LooksStatement_orderFront(_order, _front) {
    return { type: 'Order', to: 'front', loc: at(this) };
  },
  LooksStatement_orderBack(_order, _back) {
    return { type: 'Order', to: 'back', loc: at(this) };
  },

  // ==========================================================================
  //  글상자 · 붓 · 소리
  // ==========================================================================
  TextStatement_write(_write, value) {
    return { type: 'TextWrite', mode: 'write', value: value.ast(), loc: at(this) };
  },
  TextStatement_append(_append, value) {
    return { type: 'TextWrite', mode: 'append', value: value.ast(), loc: at(this) };
  },
  TextStatement_prepend(_prepend, value) {
    return { type: 'TextWrite', mode: 'prepend', value: value.ast(), loc: at(this) };
  },

  PenStatement(_stamp) {
    return { type: 'Stamp', loc: at(this) };
  },

  SoundStatement_soundForWait(_play, _sound, name, _for, duration, _and, _wait) {
    return { type: 'PlaySound', name: name.ast(), duration: duration.ast(), from: null, to: null, wait: true, loc: at(this) };
  },
  SoundStatement_soundRangeWait(_play, _sound, name, _from, from, _to, to, _and, _wait) {
    return { type: 'PlaySound', name: name.ast(), duration: null, from: from.ast(), to: to.ast(), wait: true, loc: at(this) };
  },
  SoundStatement_soundWait(_play, _sound, name, _and, _wait) {
    return { type: 'PlaySound', name: name.ast(), duration: null, from: null, to: null, wait: true, loc: at(this) };
  },
  SoundStatement_soundFor(_play, _sound, name, _for, duration) {
    return { type: 'PlaySound', name: name.ast(), duration: duration.ast(), from: null, to: null, wait: false, loc: at(this) };
  },
  SoundStatement_soundRange(_play, _sound, name, _from, from, _to, to) {
    return { type: 'PlaySound', name: name.ast(), duration: null, from: from.ast(), to: to.ast(), wait: false, loc: at(this) };
  },
  SoundStatement_sound(_play, _sound, name) {
    return { type: 'PlaySound', name: name.ast(), duration: null, from: null, to: null, wait: false, loc: at(this) };
  },
  SoundStatement_bgm(_play, _bgm, name) {
    return { type: 'PlayBgm', name: name.ast(), loc: at(this) };
  },

  // --- TTS 읽어주기 (addendum) -----------------------------------------------
  ReadStatement_readWait(_read, value, _and, _wait) {
    return { type: 'Read', value: value.ast(), wait: true, loc: at(this) };
  },
  ReadStatement_read(_read, value) {
    return { type: 'Read', value: value.ast(), wait: false, loc: at(this) };
  },
  TtsStatement(_tts, _voice, voice, _speed, speed, _pitch, pitch) {
    return {
      type: 'TtsSetting', voice: voice.ast(), speed: speed.ast(), pitch: pitch.ast(), loc: at(this),
    };
  },

  // ==========================================================================
  //  자료
  // ==========================================================================
  DataStatement_listAdd(_in, name, _add, value) {
    return { type: 'ListAdd', list: name.ast(), value: value.ast(), loc: at(this) };
  },
  DataStatement_listInsert(_in, name, _insert, value, _at, index) {
    return { type: 'ListInsert', list: name.ast(), value: value.ast(), index: index.ast(), loc: at(this) };
  },
  DataStatement_listRemove(_remove, name, _lb, index, _rb) {
    return { type: 'ListRemove', list: name.ast(), index: index.ast(), loc: at(this) };
  },
  DataStatement_ask(_ask, question) {
    return { type: 'Ask', question: question.ast(), loc: at(this) };
  },

  AssignStatement(target, operator, value) {
    return {
      type: 'Assign',
      operator: operator.sourceString,
      target: target.ast(),
      value: value.ast(),
      loc: at(this),
    };
  },
  LValue_index(name, _lb, index, _rb) {
    return { type: 'Index', target: name.ast(), index: index.ast(), loc: at(this) };
  },

  CallStatement(call) {
    return { type: 'ExpressionStatement', expression: call.ast(), loc: at(this) };
  },

  // ==========================================================================
  //  표현식
  // ==========================================================================
  OrExpr_or(left, _op, right) {
    return { type: 'Binary', operator: 'or', left: left.ast(), right: right.ast(), loc: at(this) };
  },
  AndExpr_and(left, _op, right) {
    return { type: 'Binary', operator: 'and', left: left.ast(), right: right.ast(), loc: at(this) };
  },
  NotExpr_not(_op, argument) {
    return { type: 'Unary', operator: 'not', argument: argument.ast(), loc: at(this) };
  },

  CompareExpr_eq(l, _op, r) { return binary(this, '==', l, r); },
  CompareExpr_ne(l, _op, r) { return binary(this, '!=', l, r); },
  CompareExpr_le(l, _op, r) { return binary(this, '<=', l, r); },
  CompareExpr_ge(l, _op, r) { return binary(this, '>=', l, r); },
  CompareExpr_lt(l, _op, r) { return binary(this, '<', l, r); },
  CompareExpr_gt(l, _op, r) { return binary(this, '>', l, r); },

  AddExpr_add(l, _op, r) { return binary(this, '+', l, r); },
  AddExpr_sub(l, _op, r) { return binary(this, '-', l, r); },

  MulExpr_intDiv(l, _op, r) { return binary(this, '//', l, r); },
  MulExpr_mul(l, _op, r) { return binary(this, '*', l, r); },
  MulExpr_div(l, _op, r) { return binary(this, '/', l, r); },
  MulExpr_mod(l, _op, r) { return binary(this, '%', l, r); },

  PowExpr_pow(l, _op, r) { return binary(this, '**', l, r); },

  UnaryExpr_neg(_op, argument) {
    return { type: 'Unary', operator: '-', argument: argument.ast(), loc: at(this) };
  },

  PrimaryExpr_paren(_lp, expression, _rp) {
    return expression.ast();
  },
  PrimaryExpr_transparent(_kw) {
    return { type: 'Transparent', loc: at(this) };
  },

  CallExpr(callee, _lp, args, _rp) {
    return { type: 'Call', callee: callee.ast().name, arguments: items(args), loc: at(this) };
  },
  IndexExpr(target, _lb, index, _rb) {
    return { type: 'Index', target: target.ast(), index: index.ast(), loc: at(this) };
  },
  ListLiteral(_lb, elements, _rb) {
    return { type: 'ListLiteral', elements: items(elements), loc: at(this) };
  },

  // ==========================================================================
  //  리터럴 · 식별자
  // ==========================================================================
  identifier(_name) {
    return { type: 'Identifier', name: this.sourceString, loc: at(this) };
  },

  numberLiteral_decimal(_int, _dot, _frac) {
    return { type: 'Number', value: parseFloat(this.sourceString), loc: at(this) };
  },
  numberLiteral_integer(_digits) {
    return { type: 'Number', value: parseInt(this.sourceString, 10), loc: at(this) };
  },

  stringLiteral(_open, chars, _close) {
    return { type: 'String', value: chars.children.map((c) => c.ast()).join(''), loc: at(this) };
  },
  stringChar_unicodeEscape(_prefix, h1, h2, h3, h4) {
    const hex = h1.sourceString + h2.sourceString + h3.sourceString + h4.sourceString;
    return String.fromCharCode(parseInt(hex, 16));
  },
  stringChar_escape(_backslash, ch) {
    return ESCAPES[ch.sourceString] ?? ch.sourceString;
  },
  stringChar_plain(ch) {
    return ch.sourceString;
  },

  booleanLiteral(_kw) {
    return { type: 'Boolean', value: this.sourceString === 'true', loc: at(this) };
  },
  colorLiteral(_hash, _body) {
    return { type: 'Color', value: this.sourceString.toLowerCase(), loc: at(this) };
  },

  // ==========================================================================
  //  기본 동작
  // ==========================================================================
  _iter(...children) {
    return children.map((c) => c.ast());
  },
  _terminal() {
    return this.sourceString;
  },
});

function costume(node, id, file, isDefault, width, height) {
  return {
    type: 'Costume',
    id: id.ast().name,
    file: file.ast().value,
    isDefault,
    width: width ? width.ast().value : null,
    height: height ? height.ast().value : null,
    loc: at(node),
  };
}

function binary(node, operator, left, right) {
  return { type: 'Binary', operator, left: left.ast(), right: right.ast(), loc: at(node) };
}

export { semantics, opt };
export default semantics;
