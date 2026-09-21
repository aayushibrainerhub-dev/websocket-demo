import re


YES_WORDS = {
    "yes",
    "yeah",
    "yep",
    "yup",
    "correct",
    "confirm",
    "confirmed",
    "okay",
    "ok",
    "sure",
    "send",
    "go ahead",
    "do it",
    "send it",
    "yes send it",
    "yes confirm",
    "i confirm",
    "i'm confirm",
    "im confirm",
    "i am confirm",
    "i'm confirmed",
    "im confirmed",
    "i am confirmed",
    "yes i confirm",
    "yes i'm confirm",
    "yes im confirm",
    "yes i am confirm",
    "yes i am confirmed",
}


NO_WORDS = {
    "no",
    "nope",
    "cancel",
    "stop",
    "don't",
    "dont",
    "do not",
    "no cancel",
    "cancel it",
    "don't send",
    "dont send",
    "do not send",
}


def normalize_confirmation(text: str) -> str:
    text = text.lower().strip()

    text = re.sub(r"[^\w\s']", " ", text)
    text = re.sub(r"\s+", " ", text)

    return text


def parse_confirmation(text: str) -> bool | None:
    """
    Returns:
        True  -> user confirmed
        False -> user rejected
        None  -> unclear
    """

    normalized = normalize_confirmation(text)

    if not normalized:
        return None

    # Check explicit negative phrases first.
    negative_patterns = [
        r"\bno\b",
        r"\bnope\b",
        r"\bcancel\b",
        r"\bstop\b",
        r"\bdon't send\b",
        r"\bdont send\b",
        r"\bdo not send\b",
    ]

    for pattern in negative_patterns:
        if re.search(pattern, normalized):
            return False

    # Explicit positive phrases.
    positive_patterns = [
        r"\byes\b",
        r"\byeah\b",
        r"\byep\b",
        r"\byup\b",
        r"\bokay\b",
        r"\bok\b",
        r"\bsure\b",
        r"\bconfirm\b",
        r"\bconfirmed\b",
        r"\bi confirm\b",
        r"\bi'm confirm\b",
        r"\bim confirm\b",
        r"\bi am confirm\b",
        r"\bi'm confirmed\b",
        r"\bim confirmed\b",
        r"\bi am confirmed\b",
        r"\bgo ahead\b",
        r"\bsend it\b",
        r"\byes send it\b",
    ]

    for pattern in positive_patterns:
        if re.search(pattern, normalized):
            return True

    return None