/*
 * External scanner for the Tess grammar.
 *
 * _same_line  zero-width; present only when the next token sits on the line the
 *             previous one ended on (the Chevrotain grammar's `sameLine()`).
 * color       `#` and a run of name characters that spells a colour.
 * comment     any other `#` to the end of the line.
 * _call_open  `(` right after a name that may be called (the Chevrotain
 * _index_open `[` right after a name that may be indexed  `LA(2)` gates).
 * string      a string literal; here because the generated lexer reads U+0000
 *             as the end of input.
 *
 * Colour against comment is decided without context, as the Chevrotain lexer
 * does (`@tess/core` colorLiteralLength): a colour where none may stand is a
 * parse error, never a comment. The scanner owns comments so that it is asked
 * at every position.
 */
#include "tree_sitter/parser.h"

#include <stdbool.h>
#include <stdint.h>

enum TokenType { SAME_LINE, COLOR, COMMENT, CALL_OPEN, INDEX_OPEN, STRING };

void *tree_sitter_tess_external_scanner_create(void) { return NULL; }
void tree_sitter_tess_external_scanner_destroy(void *payload) { (void)payload; }
unsigned tree_sitter_tess_external_scanner_serialize(void *payload, char *buffer) {
  (void)payload;
  (void)buffer;
  return 0;
}
void tree_sitter_tess_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
  (void)payload;
  (void)buffer;
  (void)length;
}

static bool is_line_break(int32_t c) { return c == '\n' || c == '\r' || c == 0x2028 || c == 0x2029; }

/* JavaScript's `\s` without the line breaks. */
static bool is_space(int32_t c) {
  return c == ' ' || c == '\t' || c == '\v' || c == '\f' || c == 0xA0 || c == 0xFEFF || c == 0x1680 ||
         (c >= 0x2000 && c <= 0x200A) || c == 0x202F || c == 0x205F || c == 0x3000;
}

/* Letters as `\p{L}` sees them, over the scripts Tess sources are written in. */
static bool is_letter(int32_t c) {
  if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) return true;
  if (c < 0x80) return false;
  if (c == 0xAA || c == 0xB5 || c == 0xBA) return true;
  if (c >= 0xC0 && c <= 0x24F) return c != 0xD7 && c != 0xF7;
  if (c >= 0x250 && c <= 0x2AF) return true;
  if (c >= 0x370 && c <= 0x3FF) return c != 0x37E && c != 0x387 && c != 0x375;
  if (c >= 0x400 && c <= 0x52F) return !(c >= 0x482 && c <= 0x489);
  if (c >= 0x1100 && c <= 0x11FF) return true;
  if (c >= 0x3041 && c <= 0x3096) return true;
  if (c >= 0x30A1 && c <= 0x30FA) return true;
  if (c >= 0x3131 && c <= 0x318E) return true;
  if (c >= 0x3400 && c <= 0x4DBF) return true;
  if (c >= 0x4E00 && c <= 0x9FFF) return true;
  if (c >= 0xA960 && c <= 0xA97C) return true;
  if (c >= 0xAC00 && c <= 0xD7A3) return true;
  if (c >= 0xD7B0 && c <= 0xD7FB) return true;
  if (c >= 0xF900 && c <= 0xFAFF) return true;
  if (c >= 0xFF21 && c <= 0xFF3A) return true;
  if (c >= 0xFF41 && c <= 0xFF5A) return true;
  if (c >= 0xFF66 && c <= 0xFFDC) return true;
  return false;
}

static bool is_name_char(int32_t c) { return is_letter(c) || (c >= '0' && c <= '9') || c == '_'; }

static bool is_hex(int32_t c) {
  return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
}

static int32_t lower(int32_t c) { return (c >= 'A' && c <= 'Z') ? c + 32 : c; }

/* COLOR_NAMES / COLOR_NAME_COUNT: `@tess/core` NAMED_COLORS, UTF-32, lower case. */
#include "colors.h"

#define MAX_BODY 64

/* `"(?:\\[\s\S]|[^"\\\n\r\u2028\u2029])*"`, as the Chevrotain lexer reads it. */
static bool scan_string(TSLexer *lexer) {
  lexer->advance(lexer, false);
  for (;;) {
    if (lexer->eof(lexer)) return false;
    int32_t c = lexer->lookahead;
    if (c == '"') break;
    if (c == '\\') {
      lexer->advance(lexer, false);
      if (lexer->eof(lexer)) return false;
    } else if (is_line_break(c)) {
      return false;
    }
    lexer->advance(lexer, false);
  }
  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  lexer->result_symbol = STRING;
  return true;
}

/* `=`, `+=`, `-=`, `*=`, `/=`, `%=` or `**=` ahead; reads past the marked end. */
static bool starts_assignment(TSLexer *lexer) {
  int32_t c = lexer->lookahead;
  if (c == '=') {
    lexer->advance(lexer, false);
    return lexer->lookahead != '=';
  }
  if (c == '+' || c == '-' || c == '/' || c == '%') {
    lexer->advance(lexer, false);
    return lexer->lookahead == '=';
  }
  if (c == '*') {
    lexer->advance(lexer, false);
    if (lexer->lookahead == '*') lexer->advance(lexer, false);
    return lexer->lookahead == '=';
  }
  return false;
}

static bool is_named_color(const int32_t *body, unsigned length) {
  if (length > MAX_BODY) return false;
  for (unsigned i = 0; i < COLOR_NAME_COUNT; i++) {
    const int32_t *name = COLOR_NAMES[i];
    unsigned j = 0;
    while (j < length && name[j] != 0 && name[j] == lower(body[j])) j++;
    if (j == length && name[j] == 0) return true;
  }
  return false;
}

bool tree_sitter_tess_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
  (void)payload;
  bool newline = false;
  while (is_space(lexer->lookahead) || is_line_break(lexer->lookahead)) {
    if (is_line_break(lexer->lookahead)) newline = true;
    lexer->advance(lexer, true);
  }
  // Zero-width tokens end here, before anything is read.
  lexer->mark_end(lexer);

  // Error recovery marks every symbol valid; leave it to the internal lexer.
  bool recovering = valid_symbols[SAME_LINE] && valid_symbols[CALL_OPEN] && valid_symbols[INDEX_OPEN] &&
                    valid_symbols[COLOR];

  if (!recovering && lexer->lookahead == '(' && valid_symbols[CALL_OPEN]) {
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    lexer->result_symbol = CALL_OPEN;
    return true;
  }
  if (!recovering && lexer->lookahead == '[' && valid_symbols[INDEX_OPEN]) {
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    lexer->result_symbol = INDEX_OPEN;
    return true;
  }

  bool same_line = valid_symbols[SAME_LINE] && !recovering && !newline && !lexer->eof(lexer);

  if (lexer->lookahead != '#') {
    // An assignment operator ends a name used as a target (`save = 1`).
    if (same_line && starts_assignment(lexer)) return false;
    if (same_line) {
      lexer->result_symbol = SAME_LINE;
      return true;
    }
    if (lexer->lookahead == '"' && valid_symbols[STRING]) return scan_string(lexer);
    return false;
  }

  lexer->advance(lexer, false);
  int32_t body[MAX_BODY];
  unsigned length = 0;
  bool hex = true;
  while (is_name_char(lexer->lookahead)) {
    if (length < MAX_BODY) body[length] = lexer->lookahead;
    if (!is_hex(lexer->lookahead)) hex = false;
    length++;
    lexer->advance(lexer, false);
  }
  bool color = length > 0 && (hex || is_named_color(body, length));

  if (color) {
    // A colour on the same line: the zero-width token comes first.
    if (same_line) {
      lexer->result_symbol = SAME_LINE;
      return true;
    }
    if (!valid_symbols[COLOR]) return false;
    lexer->mark_end(lexer);
    lexer->result_symbol = COLOR;
    return true;
  }

  // A comment ends the line, so nothing after it is on the same line.
  while (!lexer->eof(lexer) && !is_line_break(lexer->lookahead)) lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  lexer->result_symbol = COMMENT;
  return true;
}
