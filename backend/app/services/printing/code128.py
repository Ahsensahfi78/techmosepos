"""Code 128 (subset B/C) encoder used by the hardware diagnostic tests.

Pure Python, no third party dependencies, so it can be unit tested without a
printer or a scanner attached.

The encoder returns a list of 0/1 "modules" (1 = bar, 0 = space) which the
renderer turns into rectangles at print time.  A scanner only needs the
relative bar/space widths to be preserved, so the drawing code snaps each
module to whole printer dots.
"""

from __future__ import annotations

# 107 patterns.  Entries 0-105 are six bar/space widths summing to 11 modules;
# entry 106 is the stop pattern (seven widths summing to 13 modules).
_PATTERNS: tuple[str, ...] = (
    "212222", "222122", "222221", "121223", "121322", "131222",
    "122213", "122312", "132212", "221213", "221312", "231212",
    "112232", "122132", "122231", "113222", "123122", "123221",
    "223211", "221132", "221231", "213212", "223112", "312131",
    "311222", "321122", "321221", "312212", "322112", "322211",
    "212123", "212321", "232121", "111323", "131123", "131321",
    "112313", "132113", "132311", "211313", "231113", "231311",
    "112133", "112331", "132131", "113123", "113321", "133121",
    "313121", "211331", "231131", "213113", "213311", "213131",
    "311123", "311321", "331121", "312113", "312311", "332111",
    "314111", "221411", "431111", "111224", "111422", "121124",
    "121421", "141122", "141221", "112214", "112412", "122114",
    "122411", "142112", "142211", "241211", "221114", "413111",
    "241112", "134111", "111242", "121142", "121241", "114212",
    "124112", "124211", "411212", "421112", "421211", "212141",
    "214121", "412121", "111143", "111341", "131141", "114113",
    "114311", "411113", "411311", "113141", "114131", "311141",
    "411131", "211412", "211214", "211232", "2331112",
)

START_A = 103
START_B = 104
START_C = 105
STOP = 106

# Mid-stream code set changes (the START_* values only apply to the first
# symbol of a barcode).
SWITCH_A = 101
SWITCH_B = 100
SWITCH_C = 99

CODE_B_MIN = 32
CODE_B_MAX = 126


class BarcodeError(ValueError):
    """Raised when the payload cannot be encoded as Code 128."""


def _checksum(values: list[int]) -> int:
    total = values[0]
    for position, value in enumerate(values[1:], start=1):
        total += position * value
    return total % 103


def encode_symbols(data: str) -> list[int]:
    """Return the raw Code 128 symbol values (start code + data + checksum)."""
    if not data:
        raise BarcodeError("Barcode data must not be empty")

    chars = list(data)
    for ch in chars:
        if not (CODE_B_MIN <= ord(ch) <= CODE_B_MAX):
            raise BarcodeError(
                f"Character {ch!r} (U+{ord(ch):04X}) is outside Code 128 subset B"
            )

    data_values: list[int] = []
    code: str | None = None
    first_code: str | None = None
    index = 0
    while index < len(chars):
        run = 0
        while index + run < len(chars) and chars[index + run].isdigit():
            run += 1
        even_run = run - (run % 2)

        # Stay in code C for pairs whenever we are already there.
        target = "C" if (even_run >= 4 or (code == "C" and even_run >= 2)) else "B"
        if code != target:
            if first_code is None:
                first_code = target
            else:
                data_values.append(SWITCH_C if target == "C" else SWITCH_B)
            code = target

        if target == "C":
            for offset in range(0, even_run, 2):
                data_values.append(int(chars[index + offset] + chars[index + offset + 1]))
            index += even_run
        else:
            data_values.append(ord(chars[index]) - 32)
            index += 1

    start = START_C if first_code == "C" else START_B
    values = [start, *data_values]
    values.append(_checksum(values))
    return values


def symbol_count(data: str) -> int:
    """Number of symbols (including start and checksum, excluding stop)."""
    return len(encode_symbols(data))


def encode_modules(data: str, quiet_zone: bool = True) -> list[int]:
    """Encode ``data`` into a flat list of 0/1 modules (1 = bar)."""
    values = encode_symbols(data)
    modules: list[int] = []
    if quiet_zone:
        # 10 modules of quiet zone on each side is the Code 128 minimum.
        modules.extend([0] * 10)
    for symbol in values + [STOP]:
        pattern = _PATTERNS[symbol]
        is_bar = True
        for width in pattern:
            modules.extend([1 if is_bar else 0] * int(width))
            is_bar = not is_bar
    if quiet_zone:
        modules.extend([0] * 10)
    return modules


def decode_modules(modules: list[int]) -> str:
    """Decode modules produced by :func:`encode_modules` back to text.

    Used by the automated tests to prove the encoder round-trips and that the
    checksum is correct, without needing a physical scanner.
    """
    body = list(modules)
    # Strip the quiet zones (leading/trailing zeros).
    while body and body[0] == 0:
        body.pop(0)
    while body and body[-1] == 0:
        body.pop()

    patterns: dict[str, int] = {}
    for symbol, pattern in enumerate(_PATTERNS):
        patterns[pattern] = symbol

    symbols: list[int] = []
    index = 0
    total = len(body)
    while index < total:
        if body[index] != 1:
            raise BarcodeError("Expected a bar at a symbol boundary")
        widths: list[str] = []
        polarity = 1
        # Every symbol except the stop pattern has six widths (bar, space, ...).
        while len(widths) < 6 and index < total and body[index] == polarity:
            run = 0
            while index < total and body[index] == polarity:
                run += 1
                index += 1
            widths.append(str(run))
            polarity = 0 if polarity == 1 else 1

        key = "".join(widths)
        if key not in patterns:
            # The stop pattern has a seventh (bar) width.
            if len(widths) == 6 and index < total and body[index] == polarity:
                run = 0
                while index < total and body[index] == polarity:
                    run += 1
                    index += 1
                key = key + str(run)
            if key not in patterns:
                raise BarcodeError(f"Unrecognised Code 128 pattern {key!r}")
        symbols.append(patterns[key])
        if symbols[-1] == STOP:
            break

    if not symbols or symbols[-1] != STOP:
        raise BarcodeError("Missing stop pattern")
    if symbols[0] not in (START_A, START_B, START_C):
        raise BarcodeError("Missing start pattern")

    payload = symbols[:-1]
    if len(payload) < 2:
        raise BarcodeError("Decoded symbol stream is too short")
    expected = _checksum(payload[:-1])
    if payload[-1] != expected:
        raise BarcodeError(
            f"Checksum mismatch: got {payload[-1]}, expected {expected}"
        )

    text: list[str] = []
    code = {START_A: "A", START_B: "B", START_C: "C"}[payload[0]]
    i = 1
    while i < len(payload) - 1:  # last element is the checksum
        value = payload[i]
        if code == "B":
            if value == SWITCH_C:
                code = "C"
            elif value == SWITCH_A:
                code = "A"
            elif value == SWITCH_B:
                pass  # FNC4 in code set B
            else:
                text.append(chr(value + 32))
        elif code == "C":
            if value == SWITCH_B:
                code = "B"
            elif value == SWITCH_A:
                code = "A"
            else:
                text.append(f"{value:02d}")
        else:  # code set A
            if value == SWITCH_C:
                code = "C"
            elif value == SWITCH_B:
                code = "B"
            elif value == SWITCH_A:
                pass  # FNC4 in code set A
            elif value < 96:
                text.append(chr(value + 32))
            else:
                text.append(chr(value - 32))
        i += 1
    return "".join(text)
