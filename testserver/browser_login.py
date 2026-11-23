#!/usr/bin/env python3
"""Signs a test user in inside the web client of the test server (browser tests) through Quick Connect.

    1. In the browser, open the sign-in page and click "Use Quick Connect": it shows a code.
    2. python3 testserver/browser_login.py alice <code>

No password is typed or printed. Quick Connect must be enabled on the test server (setup.py does that).
"""
import sys

import jf


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    client = jf.login(sys.argv[1])
    resp = client.post("/QuickConnect/Authorize", params={"code": sys.argv[2], "userId": client.user_id})
    print(resp.status, resp.text()[:100])


if __name__ == "__main__":
    main()
