# CLAUDE.md — AI 어시스턴트 행동 및 프로젝트 작성 지침

이 프로젝트에서 작업할 때는 다음 원칙과 제약 사항을 **반드시 엄격하게 준수**해야 합니다.

## 1. 문서화 정책 및 권한 분리 (Strict Documentation Separation)

### 사용자용 문서 수정 절대 금지 (Protected User Docs)

- 다음 파일들은 **사용자(End-User)를 위한 문서**이며, 명시적인 요청이 없는 한 **절대로 수정하거나 덮어쓰지 마십시오.**
  - `README.md`
  - `tutorial.md` (또는 `tuto/` 하위 파일)
  - `SPEC.md`, `SPEC-ADDENDUM.md`, `GRAMMAR.md`
- 사용자용 문서는 **극도로 간결하고(Minimal), 사용자가 바로 실행해 볼 수 있는 안내(Quick-start)**만을 담아야 합니다.

### AI 전용 기록 문서 (Dedicated AI Documentation)

- 모든 기술적 상세, 아키텍처 분석, 컴파일러 설계 의도, 파싱 이론, 수학적 공식 유도, 구현 세부 사항은 **오직 지정된 AI 전용 마크다운 파일**에만 기록합니다.
  - **지정 파일:** `AI_**.md`
- 당신이 분석한 방대한 내용, 트러블슈팅 과정, 파일 구조표 등은 **무조건 이 파일에만 작성**하십시오.

---

## 2. "개발 일지화(회고록)" 절대 금지 규칙 (No Diary / Journaling)

코드 주석, 커밋 메시지, 사용자 문서에 **개인적인 개발 여정, 고뇌, 학습 경험 등을 서술하는 것을 엄격히 금지**합니다.

- **금지된 표현 스타일 (개발 일지 스타일):**
  - "이 부분은 ~튜토리얼에서 배운 기법을 써봤습니다."
  - "엔트리에는 이 블록이 없어서 고민하다가 뉴턴법을 써서 역산해 보았습니다."
  - "처음에는 A 방식으로 짰는데 버그가 나서 B 방식으로 우회했습니다."
- **권장되는 표현 스타일 (전문적이고 객관적인 명세):**
  - "Computes scale using inverse calculation."
  - "Approximates exponentiation using Newton-Raphson iteration."

---

## 3. 코드 주석 작성 규칙 (Code Commenting Standard)

1. **언어:** 오직 **영어(English)**만 사용합니다.
2. **간결성:** 무엇을(What) 하는지만 1~2줄로 명확하고 드라이하게 작성합니다.
3. **일기장 금지:** 코드 주석에 디버깅 과정의 스토리텔링을 적지 마십시오.
4. **포맷 예시:**

```javascript
   //  Bad (Storytelling ):
   // 엔트리에는 scale_x 블록이 없어서 한참 고민하다가 크기를 임시로 늘려보고 복구하는 함수를 만들었습니다.

   //  Good (Objective / Concise):
   // calc aspect ratio manually.
   function generateScaleHelper() { ... }
```

---

## 5. 작업 전 체크리스트 (Claude Pre-Execution Checklist)

작업을 완료하고 결과를 출력하기 전, 다음 사항을 스스로 점검하십시오.

- [ ] 사용자용 문서(`README.md`, `tutorial.md` 등)를 무단으로 길게 늘리거나 수정하지 않았는가?
- [ ] 기술적인 장문의 설명과 구현 원리를 `AI_**.md`에만 격리하여 작성했는가?
- [ ] 코드의 모든 주석이 일기장 형태가 아닌 객관적인 설명인가?
- [ ] 사용자의 질문에 대한 채팅 "답변"은 한국어로 작성하고 있는가?
