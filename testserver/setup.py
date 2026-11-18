#!/usr/bin/env python3
"""Initial setup of the local test server: wizard, users, music library.

Users: testadmin (administrator), alice, bob, carol, dave (normal users, hidden from the login screen).
carol has no access to the library "Private Music".
Passwords are generated and stored in testserver/.state/credentials.json (git-ignored).
"""
import sys
import time

import jf

ADMIN = "testadmin"
USERS = ["alice", "bob", "carol", "dave"]
RESTRICTED_USER = "carol"
LIBRARIES = {"Music": "/data/music", "Private Music": "/data/music-private"}
EXPECTED_TRACKS = None  # counted from disk below


def wait_for_server(known_admin):
    """Waits until the real server answers (during startup a placeholder answers with a 503 or resets)."""
    anon = jf.Client()
    for _ in range(180):
        try:
            resp = anon.get("/System/Info/Public")
            if resp.status == 200:
                info = resp.json()
                completed = info.get("StartupWizardCompleted", info.get("startupWizardCompleted"))
                # After the first setup the wizard must be reported as done; anything else is the placeholder.
                if completed or not known_admin:
                    return bool(completed)
        except (OSError, ValueError):
            pass
        time.sleep(1)
    raise SystemExit("server did not come up")  # a known admin but a fresh server: run testserver/reset.sh


def main():
    state = jf.load_state()
    state.setdefault("users", {})
    wizard_done = wait_for_server(ADMIN in state["users"])
    anon = jf.Client()

    if not wizard_done:
        # The placeholder that answers during startup also reports "wizard not completed";
        # the wizard endpoints only answer once the real server is up.
        for _ in range(180):
            try:
                if anon.get("/Startup/Configuration").status == 200:
                    break
            except OSError:
                pass  # the server is still starting
            time.sleep(1)
        else:
            raise SystemExit("wizard endpoints did not come up")
        if ADMIN not in state["users"]:
            state["users"][ADMIN] = jf.new_password()
            jf.save_state(state)
        assert anon.post("/Startup/Configuration", {"UICulture": "en-US", "MetadataCountryCode": "US", "PreferredMetadataLanguage": "en"}).status == 204
        anon.get("/Startup/User")
        assert anon.post("/Startup/User", {"Name": ADMIN, "Password": state["users"][ADMIN]}).status == 204
        assert anon.post("/Startup/RemoteAccess", {"EnableRemoteAccess": True}).status == 204
        assert anon.post("/Startup/Complete").status == 204
        print("wizard completed")

    admin = jf.login(ADMIN)
    existing = {u["Name"]: u for u in admin.get("/Users").json()}
    for name in USERS:
        if name not in existing:
            state["users"][name] = jf.new_password()
            jf.save_state(state)
            resp = admin.post("/Users/New", {"Name": name, "Password": state["users"][name]})
            assert resp.status == 200, resp.text()
            user = resp.json()
            policy = user["Policy"]
            policy["IsHidden"] = True
            policy["IsAdministrator"] = False
            assert admin.post(f"/Users/{user['Id']}/Policy", policy).status == 204
            print("created user", name)

    no_remote = [{"Type": t, "MetadataFetchers": [], "ImageFetchers": []} for t in ("MusicAlbum", "MusicArtist", "Audio")]
    for name, path in LIBRARIES.items():
        if not any(f["Name"] == name for f in admin.get("/Library/VirtualFolders").json()):
            options = {"LibraryOptions": {"PathInfos": [{"Path": path}], "EnableRealtimeMonitor": False, "TypeOptions": no_remote}}
            resp = admin.post("/Library/VirtualFolders", options, params={"name": name, "collectionType": "music", "refreshLibrary": "true"})
            assert resp.status == 204, resp.text()
            print(f"library {name} created, scanning")

    # carol may only use the open library; the private one must stay hidden from her everywhere.
    library_ids = {f["Name"]: f["ItemId"] for f in admin.get("/Library/VirtualFolders").json()}
    carol = next(u for u in admin.get("/Users").json() if u["Name"] == RESTRICTED_USER)
    policy = carol["Policy"]
    if policy.get("EnableAllFolders") or policy.get("EnabledFolders") != [library_ids["Music"]]:
        policy["EnableAllFolders"] = False
        policy["EnabledFolders"] = [library_ids["Music"]]
        assert admin.post(f"/Users/{carol['Id']}/Policy", policy).status == 204
        print(f"{RESTRICTED_USER} restricted to the library Music")

    expected = sum(1 for root in ("music", "music-private") for f in (jf.HERE / root).rglob("*.opus") if ".base" not in f.parts)
    for _ in range(600):
        count = admin.get("/Items", params={"IncludeItemTypes": "Audio", "Recursive": "true", "Limit": "0", "UserId": admin.user_id}).json()["TotalRecordCount"]
        if count >= expected:
            break
        # A library created while a scan was already running is not picked up by that scan.
        scan = next(t for t in admin.get("/ScheduledTasks").json() if t["Key"] == "RefreshLibrary")
        if scan["State"] == "Idle":
            admin.post("/Library/Refresh")
        time.sleep(2)
    else:
        raise SystemExit(f"scan incomplete: {count} of {expected}")
    # Items appear before their tags are read; wait for the scan task to finish.
    for _ in range(600):
        task = next(t for t in admin.get("/ScheduledTasks").json() if t["Key"] == "RefreshLibrary")
        if task["State"] == "Idle":
            break
        time.sleep(2)
    print(f"{count} tracks in library (expected {expected})")


if __name__ == "__main__":
    sys.exit(main())
