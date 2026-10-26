"""The storage contract shared by the API, preview bridge and model context.

Keys are opaque SQLite values, never paths or JavaScript property paths.
Namespaced keys remain literal so existing generated applications need no migration.
"""
import re


RULES = {
    'keyPattern': r'^[A-Za-z0-9_.:-]{1,80}$',
    'reservedKeys': ['__proto__', 'constructor', 'prototype'],
    'maxValueBytes': 500_000,
    'maxPending': 24,
    'writesPerSecond': 20,
}


def valid_key(key):
    return (isinstance(key, str) and key not in RULES['reservedKeys']
            and re.fullmatch(RULES['keyPattern'], key) is not None)


def model_guidance():
    return (f"Storage keys must match {RULES['keyPattern']} and must not be "
            f"{', '.join(RULES['reservedKeys'])}. Dots and colons are literal namespacing characters; "
            "keep existing keys unchanged. Values must be JSON data. "
            "Await FormaStore.set before confirming an operation as saved. "
            "On failure keep the user's input and show an inline error with retry; never swallow save errors. "
            "If rendering optimistically, distinguish pending/unsaved changes and roll back or retain a retryable draft on failure.")
