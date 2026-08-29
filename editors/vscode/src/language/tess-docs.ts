// ============================================================================
//  Reference text shown in completion and hover
//
//  Entries carry the form the grammar accepts and one line on what it does.
//  Text is Korean to match the compiler's diagnostics and the language guide.
// ============================================================================

export interface TessDoc {
    /** How the construct is written. */
    signature: string;
    /** One line summary. */
    summary: string;
    /** Optional example, rendered as a Tess code block. */
    example?: string;
}

/** Statement and declaration keywords, keyed by the word that starts them. */
export const STATEMENT_DOCS: Record<string, TessDoc> = {
    project: { signature: 'project: … end', summary: '작품 정보를 정합니다. 작품 전체에 하나만 둘 수 있습니다.', example: 'project:\n  title "내 작품"\n  fps 60\nend' },
    scene: { signature: 'scene "이름": … end', summary: '장면을 선언합니다. 안에 오브젝트를 넣습니다.' },
    object: { signature: 'object "이름": … end', summary: '오브젝트를 선언합니다.' },
    text: { signature: 'text "이름": … end', summary: '글상자를 선언합니다. 글상자 전용 속성과 명령을 쓸 수 있습니다.' },
    function: { signature: 'function 이름(매개변수…): … end', summary: '함수를 선언합니다. 매개변수 뒤에 `?` 를 붙이면 판단값이 됩니다.', example: 'function 더하기(a, b):\n  return a + b\nend' },
    use: { signature: 'use "파일.tess"', summary: '다른 파일의 내용을 이 자리에 끼워 넣습니다.' },
    useobject: { signature: 'useobject "파일.tess"', summary: '다른 파일에 적힌 오브젝트를 가져옵니다.' },
    usetext: { signature: 'usetext "파일.tess"', summary: '다른 파일에 적힌 글상자를 가져옵니다.' },
    var: { signature: 'var 이름 = 값', summary: '변수를 선언합니다. 최상위면 전역, 오브젝트 안이면 그 오브젝트 전용입니다.' },
    list: { signature: 'list 이름 = [값, …]', summary: '리스트를 선언합니다. 인덱스는 0부터입니다.' },
    when: { signature: 'when 사건 do … end', summary: '사건이 일어났을 때 실행할 스크립트를 답니다.', example: 'when key "space" do\n  jump 10\nend' },
    if: { signature: 'if 조건: … else: … end', summary: '조건이 참일 때만 실행합니다.' },
    else: { signature: 'else: … end', summary: '`if` 의 조건이 거짓일 때 실행합니다.' },
    repeat: { signature: 'repeat 횟수: … end', summary: '정해진 횟수만큼 되풀이합니다.' },
    while: { signature: 'while 조건: … end', summary: '조건이 참인 동안 되풀이합니다.' },
    until: { signature: 'until 조건: … end', summary: '조건이 참이 될 때까지 되풀이합니다.' },
    forever: { signature: 'forever: … end', summary: '계속 되풀이합니다.' },
    break: { signature: 'break', summary: '반복문을 빠져나옵니다.' },
    skip: { signature: 'skip', summary: '이번 회차를 건너뛰고 다음 회차로 갑니다.' },
    restart: { signature: 'restart', summary: '이 스크립트를 처음부터 다시 실행합니다.' },
    return: { signature: 'return 값', summary: '함수의 결과를 돌려줍니다. 함수 안에서만 쓸 수 있습니다.' },
    wait: { signature: 'wait 초', summary: '정해진 시간만큼 멈춥니다.' },
    stop: { signature: 'stop / stop all / stop other / stop sound all …', summary: '스크립트나 소리, 그리기, 초시계를 멈춥니다.' },
    start: { signature: 'start draw / start fill / start timer', summary: '그리기·채우기·초시계를 시작합니다.' },
    reset: { signature: 'reset size / reset timer', summary: '크기나 초시계를 처음 값으로 되돌립니다.' },
    clear: { signature: 'clear effects / bubble / draw / text', summary: '효과·말풍선·그린 선·글상자 내용을 지웁니다.' },
    send: { signature: 'send "신호"', summary: '신호를 보내고 곧바로 다음 줄로 갑니다.' },
    call: { signature: 'call "신호"', summary: '신호를 보내고 그 스크립트가 끝날 때까지 기다립니다.' },
    clone: { signature: 'clone / clone "대상"', summary: '자기 자신이나 대상의 복제본을 만듭니다.' },
    del: { signature: 'del clone / del clones', summary: '이 복제본 하나 또는 모든 복제본을 지웁니다.' },
    kill: { signature: 'kill', summary: '이 복제본을 지웁니다.' },
    jump: { signature: 'jump "장면" / jump next / jump back', summary: '다른 장면으로 넘어갑니다.' },
    forward: { signature: 'forward 거리 (at 각도)?', summary: '보는 방향으로 나아갑니다.' },
    bounce: { signature: 'bounce', summary: '화면 끝에 닿으면 튕깁니다.' },
    move: { signature: 'move x y (in 초)?', summary: '지금 위치에서 x·y 만큼 옮깁니다.' },
    go: { signature: 'go x y (in 초)? / go "대상" (in 초)?', summary: '정해진 좌표나 대상 위치로 갑니다.' },
    turn: { signature: 'turn 각도 (in 초)?', summary: '모양 각도를 돌립니다.' },
    steer: { signature: 'steer 각도 (in 초)?', summary: '이동 방향을 돌립니다.' },
    look: { signature: 'look "대상"', summary: '대상 쪽을 바라봅니다.' },
    show: { signature: 'show / show 이름', summary: '보이게 합니다. 이름을 적으면 그 변수·리스트를 화면에 띄웁니다.' },
    hide: { signature: 'hide / hide 이름', summary: '숨깁니다.' },
    next: { signature: 'next costume', summary: '다음 모양으로 바꿉니다.' },
    prev: { signature: 'prev costume', summary: '이전 모양으로 바꿉니다.' },
    say: { signature: 'say 값 (for 초)?', summary: '말풍선으로 말합니다.' },
    think: { signature: 'think 값 (for 초)?', summary: '생각 풍선을 띄웁니다.' },
    flip: { signature: 'flip x / flip y', summary: '좌우 또는 상하로 뒤집습니다.' },
    order: { signature: 'order front / back / first / last', summary: '그리는 순서를 바꿉니다.' },
    write: { signature: 'write 값', summary: '글상자 내용을 이 값으로 바꿉니다. 글상자 전용입니다.' },
    append: { signature: 'append 값', summary: '글상자 내용 뒤에 덧붙입니다. 글상자 전용입니다.' },
    prepend: { signature: 'prepend 값', summary: '글상자 내용 앞에 덧붙입니다. 글상자 전용입니다.' },
    stamp: { signature: 'stamp', summary: '지금 모습을 화면에 찍습니다.' },
    play: { signature: 'play sound "이름" … / play bgm "이름"', summary: '소리를 재생합니다.' },
    read: { signature: 'read 값 (and wait)?', summary: '값을 소리 내어 읽습니다.' },
    tts: { signature: 'tts voice "…" speed "…" pitch "…"', summary: '읽어 주는 목소리를 정합니다.' },
    ask: { signature: 'ask "질문"', summary: '입력창을 띄우고 대답을 기다립니다. 대답은 `answer` 로 읽습니다.' },
    in: { signature: 'in 리스트 add 값 / in 리스트 insert 값 at 위치', summary: '리스트에 값을 넣습니다.' },
    remove: { signature: 'remove 리스트[위치]', summary: '리스트에서 항목을 뺍니다.' },
    costume: { signature: '(default)? costume 이름 "파일" (size 가로 세로)?', summary: '오브젝트의 모양을 등록합니다.' },
    sound: { signature: 'sound 이름 "파일" (for 길이)?', summary: '오브젝트의 소리를 등록합니다.' },
    end: { signature: 'end', summary: '블록을 닫습니다.' },
};

/** Built in functions, keyed by name. */
export const FUNCTION_DOCS: Record<string, TessDoc> = {
    key_down: { signature: 'key_down("키")', summary: '그 키가 눌려 있는지 판단합니다.' },
    touching: { signature: 'touching("대상")', summary: '대상에 닿았는지 판단합니다. `"wall"` 도 쓸 수 있습니다.' },
    type: { signature: 'type(값)', summary: '값의 자료형을 돌려줍니다.' },
    sin: { signature: 'sin(각도)', summary: '사인값 (도 단위).' },
    cos: { signature: 'cos(각도)', summary: '코사인값 (도 단위).' },
    tan: { signature: 'tan(각도)', summary: '탄젠트값 (도 단위).' },
    asin: { signature: 'asin(값)', summary: '아크사인 (도 단위).' },
    acos: { signature: 'acos(값)', summary: '아크코사인 (도 단위).' },
    atan: { signature: 'atan(값)', summary: '아크탄젠트 (도 단위).' },
    log2: { signature: 'log2(값)', summary: '밑이 2인 로그.' },
    ln: { signature: 'ln(값)', summary: '자연로그.' },
    log10: { signature: 'log10(값)', summary: '상용로그.' },
    floor: { signature: 'floor(값)', summary: '내림.' },
    ceil: { signature: 'ceil(값)', summary: '올림.' },
    round: { signature: 'round(값)', summary: '반올림.' },
    abs: { signature: 'abs(값)', summary: '절댓값.' },
    random: { signature: 'random(a, b)', summary: 'a 이상 b 이하의 무작위 정수.' },
    root: { signature: 'root(값, n)', summary: 'n 제곱근. `값 ** (1/n)` 과 같습니다.' },
    x: { signature: 'x / x("대상")', summary: 'x 좌표. 이름을 빼면 자기 자신입니다.' },
    y: { signature: 'y / y("대상")', summary: 'y 좌표.' },
    angle: { signature: 'angle / angle("대상")', summary: '모양 각도.' },
    way: { signature: 'way / way("대상")', summary: '이동 방향.' },
    size: { signature: 'size / size("대상")', summary: '전체 크기(%).' },
    costume: { signature: 'costume / costume("대상")', summary: '지금 모양의 이름.' },
    costume_number: { signature: 'costume_number / costume_number("대상")', summary: '지금 모양이 목록에서 몇 번째인지 (1부터).' },
    distance: { signature: 'distance("대상")', summary: '대상까지의 거리. `"mouse"` 도 쓸 수 있습니다.' },
    text_content: { signature: 'text_content("대상")', summary: '글상자의 지금 내용.' },
    block_count: { signature: 'block_count / block_count("대상")', summary: '블록 수.' },
    length: { signature: 'length(값)', summary: '문자열이나 리스트의 길이.' },
    slice: { signature: 'slice(문자열, 시작, 끝)', summary: '부분 문자열. 인덱스는 0부터입니다.' },
    count: { signature: 'count(문자열, 찾을값)', summary: '나오는 횟수.' },
    join: { signature: 'join(a, b)', summary: '이어 붙입니다.' },
    index_of: { signature: 'index_of(문자열, 찾을값)', summary: '처음 나오는 위치 (0부터, 없으면 -1).' },
    replace: { signature: 'replace(문자열, 찾을값, 바꿀값)', summary: '바꿉니다.' },
    reverse: { signature: 'reverse(문자열)', summary: '뒤집습니다.' },
    uppercase: { signature: 'uppercase(문자열)', summary: '대문자로 바꿉니다.' },
    lowercase: { signature: 'lowercase(문자열)', summary: '소문자로 바꿉니다.' },
    contains: { signature: 'contains(리스트, 값)', summary: '리스트에 값이 있는지 판단합니다.' },
    sound_duration: { signature: 'sound_duration("소리")', summary: '소리의 길이(초).' },
    now: { signature: 'now("year")', summary: '지금 시각. `year|month|day|hour|minute|second|weekday`.' },
    to_hex: { signature: 'to_hex(r, g, b)', summary: 'RGB 값을 `"#ff0000"` 같은 색 문자열로 바꿉니다.' },
    from_hex: { signature: 'from_hex(#ff0000, red)', summary: '색에서 성분 하나를 꺼냅니다. `red | green | blue`.' },
    random_color: { signature: 'random_color()', summary: '무작위 색.' },
};

/** Read only state values, written without parentheses. */
export const STATE_DOCS: Record<string, TessDoc> = {
    mouse_down: { signature: 'mouse_down', summary: '마우스 버튼이 눌려 있는지.' },
    clicked: { signature: 'clicked', summary: '이 오브젝트가 클릭된 상태인지.' },
    boost_mode: { signature: 'boost_mode', summary: '저사양 모드인지.' },
    touchable: { signature: 'touchable', summary: '터치를 지원하는 기기인지.' },
    device: { signature: 'device', summary: '실행 기기. `"mobile"` 등과 비교합니다.' },
    user_id: { signature: 'user_id', summary: '로그인한 사용자 아이디.' },
    nickname: { signature: 'nickname', summary: '로그인한 사용자 닉네임.' },
    timer: { signature: 'timer', summary: '초시계 값(초).' },
    answer: { signature: 'answer', summary: '`ask` 로 받은 마지막 대답.' },
    block_count: { signature: 'block_count', summary: '이 작품의 전체 블록 수.' },
    costume_number: { signature: 'costume_number', summary: '지금 모양이 목록에서 몇 번째인지 (1부터).' },
};

/** Writable object properties. */
export const PROPERTY_DOCS: Record<string, TessDoc> = {
    x: { signature: 'x = 값', summary: 'x 좌표.' },
    y: { signature: 'y = 값', summary: 'y 좌표.' },
    size: { signature: 'size = 값', summary: '전체 크기(%).' },
    scale_x: { signature: 'scale_x = 값', summary: '가로 크기.' },
    scale_y: { signature: 'scale_y = 값', summary: '세로 크기.' },
    angle: { signature: 'angle = 값', summary: '모양 각도.' },
    way: { signature: 'way = 값', summary: '이동 방향.' },
    costume: { signature: 'costume = "이름"', summary: '지금 모양.' },
    rotation: { signature: 'rotation free | vertical | none', summary: '회전 방식.' },
    visible: { signature: 'visible true | false', summary: '처음에 보일지.' },
    lock: { signature: 'lock true | false', summary: '움직이지 못하게 잠글지.' },
    name: { signature: 'name "이름"', summary: '화면에 보일 이름.' },
    center: { signature: 'center x y', summary: '중심점. 오브젝트 전용입니다.' },
    effect_color: { signature: 'effect_color = 값', summary: '색깔 효과.' },
    effect_brightness: { signature: 'effect_brightness = 값', summary: '밝기 효과.' },
    effect_alpha: { signature: 'effect_alpha = 값', summary: '투명도 효과.' },
    draw_color: { signature: 'draw_color = #ff0000', summary: '붓 색.' },
    draw_width: { signature: 'draw_width = 값', summary: '붓 굵기.' },
    draw_alpha: { signature: 'draw_alpha = 값', summary: '붓 투명도.' },
    fill_color: { signature: 'fill_color = #ff0000', summary: '채우기 색.' },
    sound_volume: { signature: 'sound_volume = 값', summary: '소리 크기.' },
    sound_speed: { signature: 'sound_speed = 값', summary: '소리 빠르기.' },
    text_content: { signature: 'text_content = "글"', summary: '글상자 내용. 글상자 전용입니다.' },
    font: { signature: 'font = "글꼴"', summary: '글꼴. 글상자 전용입니다.' },
    font_color: { signature: 'font_color = #000000', summary: '글자 색. 글상자 전용입니다.' },
    bg_color: { signature: 'bg_color = #ffffff', summary: '배경 색. 글상자 전용입니다.' },
    font_size: { signature: 'font_size = 값', summary: '글자 크기. 글상자 전용입니다.' },
    text_bold: { signature: 'text_bold = true', summary: '굵게. 글상자 전용입니다.' },
    text_italic: { signature: 'text_italic = true', summary: '기울임. 글상자 전용입니다.' },
    text_underline: { signature: 'text_underline = true', summary: '밑줄. 글상자 전용입니다.' },
    text_strikethrough: { signature: 'text_strikethrough = true', summary: '취소선. 글상자 전용입니다.' },
    text_align: { signature: 'text_align = 값', summary: '정렬. 글상자 전용입니다.' },
    line_break: { signature: 'line_break = true', summary: '여러 줄 쓰기. 글상자 전용입니다.' },
};

/** The event forms `when` accepts, as snippet bodies. */
export const EVENT_FORMS: Array<{ label: string; insert: string; summary: string }> = [
    { label: 'when start', insert: 'when start do\n\t$0\nend', summary: '시작 버튼을 눌렀을 때.' },
    { label: 'when scene start', insert: 'when scene start do\n\t$0\nend', summary: '장면이 시작됐을 때.' },
    { label: 'when key', insert: 'when key "${1:space}" do\n\t$0\nend', summary: '키를 눌렀을 때.' },
    { label: 'when key up', insert: 'when key "${1:space}" up do\n\t$0\nend', summary: '키를 뗐을 때.' },
    { label: 'when click', insert: 'when click do\n\t$0\nend', summary: '이 오브젝트를 클릭했을 때.' },
    { label: 'when click up', insert: 'when click up do\n\t$0\nend', summary: '클릭을 뗐을 때.' },
    { label: 'when stage click', insert: 'when stage click do\n\t$0\nend', summary: '화면을 클릭했을 때.' },
    { label: 'when signal', insert: 'when signal "${1:신호}" do\n\t$0\nend', summary: '신호를 받았을 때.' },
    { label: 'when cloned', insert: 'when cloned do\n\t$0\nend', summary: '복제본이 만들어졌을 때.' },
];

/** Blocks that open with `:` / `then` / `do` and close with `end`. */
export const BLOCK_SNIPPETS: Array<{ label: string; insert: string; summary: string }> = [
    { label: 'if', insert: 'if ${1:조건}:\n\t$0\nend', summary: '조건이 참일 때만 실행합니다.' },
    { label: 'if else', insert: 'if ${1:조건}:\n\t$2\nelse:\n\t$0\nend', summary: '조건에 따라 갈라집니다.' },
    { label: 'repeat', insert: 'repeat ${1:10}:\n\t$0\nend', summary: '정해진 횟수만큼 되풀이합니다.' },
    { label: 'while', insert: 'while ${1:조건}:\n\t$0\nend', summary: '조건이 참인 동안 되풀이합니다.' },
    { label: 'until', insert: 'until ${1:조건}:\n\t$0\nend', summary: '조건이 참이 될 때까지 되풀이합니다.' },
    { label: 'forever', insert: 'forever:\n\t$0\nend', summary: '계속 되풀이합니다.' },
    { label: 'function', insert: 'function ${1:이름}(${2:매개변수}):\n\t$0\nend', summary: '함수를 선언합니다.' },
    { label: 'object', insert: 'object "${1:이름}":\n\t$0\nend', summary: '오브젝트를 선언합니다.' },
    { label: 'text', insert: 'text "${1:이름}":\n\t$0\nend', summary: '글상자를 선언합니다.' },
    { label: 'scene', insert: 'scene "${1:이름}":\n\t$0\nend', summary: '장면을 선언합니다.' },
    { label: 'project', insert: 'project:\n\ttitle "${1:작품 이름}"\n\tfps ${2:60}\nend', summary: '작품 정보를 정합니다.' },
];

/** Renders a doc entry as markdown for hover. */
export function renderDoc(doc: TessDoc, title?: string): string {
    const head = title ? `**${title}**\n\n` : '';
    const example = doc.example ? `\n\n\`\`\`tess\n${doc.example}\n\`\`\`` : '';
    return `${head}\`\`\`tess\n${doc.signature}\n\`\`\`\n\n${doc.summary}${example}`;
}

/** Looks a word up across every reference table. */
export function findDoc(name: string): TessDoc | undefined {
    return FUNCTION_DOCS[name] ?? STATE_DOCS[name] ?? PROPERTY_DOCS[name] ?? STATEMENT_DOCS[name];
}
