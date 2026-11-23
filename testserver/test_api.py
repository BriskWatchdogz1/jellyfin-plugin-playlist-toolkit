#!/usr/bin/env python3
"""End-to-end API tests against the local test server.

Everything is exercised as a normal (non-admin) playlist owner; the negative cases use
other normal users and the administrator. Run after setup.py:

    python3 testserver/test_api.py
"""
import collections
import datetime
import subprocess
import sys
import tempfile
import time
import urllib.parse

import jf
import wsclient

RESULTS = []
PLUGIN_ID = "fd26499be4c14a7d8648a898f06e647b"


def check(name, condition, detail=""):
    RESULTS.append((name, bool(condition), detail))
    print(("PASS  " if condition else "FAIL  ") + name + (f"   [{detail}]" if detail else ""))


def make_image(fmt, size=64, color="red"):
    with tempfile.TemporaryDirectory() as tmp:
        path = f"{tmp}/img.{fmt}"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color={color}:size={size}x{size}", "-frames:v", "1", path], check=True)
        with open(path, "rb") as handle:
            return handle.read()


def audio_items(client, **params):
    query = {"IncludeItemTypes": "Audio", "Recursive": "true", "UserId": client.user_id, "SortBy": "SortName", "Limit": "5000", "Fields": "Path"}
    query.update(params)
    return client.get("/Items", params=query).json()["Items"]


def create_playlist(client, name, ids, public=False):
    resp = client.post("/Playlists", {"Name": name, "Ids": ids, "UserId": client.user_id, "MediaType": "Audio", "IsPublic": public})
    assert resp.status == 200, resp.text()
    return resp.json()["Id"]


def delete_test_playlists(clients):
    for client in clients:
        for item in client.get("/Items", params={"IncludeItemTypes": "Playlist", "Recursive": "true", "UserId": client.user_id}).json()["Items"]:
            if item["Name"].startswith("T-"):
                client.delete(f"/Items/{item['Id']}")


def wait_until(predicate, timeout=30, step=0.5):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(step)
    return False


# ------------------------------------------------------------------- automatic playlists
def nodash(value):
    return value.replace("-", "").lower()


def set_heart(client, item_id, on=True):
    path = f"/UserFavoriteItems/{item_id}"
    return client.post(path) if on else client.delete(path)


def set_dislike(client, item_id, on=True):
    path = f"/UserItems/{item_id}/Rating"
    return client.post(path, params={"likes": "false"}) if on else client.delete(path)


def auto_state(client):
    return client.get("/PlaylistToolkit/AutoPlaylists").json()


def stock_playlists(client):
    return client.get("/Items", params={"IncludeItemTypes": "Playlist", "Recursive": "true", "UserId": client.user_id}).json()["Items"]


def playlist_ids(client, pid):
    resp = client.get(f"/Playlists/{pid}/Items", params={"userId": client.user_id})
    return [nodash(i["Id"]) for i in resp.json()["Items"]] if resp.status == 200 else None


def auto_pid(client, kind):
    value = auto_state(client)[kind].get("PlaylistId")
    return nodash(value) if value else None


def wait_items(client, kind, expected, timeout):
    """Waits until the automatic playlist of a kind holds exactly the expected ids in that order."""
    def done():
        pid = auto_pid(client, kind)
        return pid is not None and playlist_ids(client, pid) == [nodash(e) for e in expected]
    return wait_until(done, timeout=timeout, step=0.3)


def automatic_playlists(admin, alice, bob, dave, settings, small, bulk):
    delay = settings.get("AutoPlaylistSyncDelaySeconds", 2)
    wait = delay + 10
    base = dict(EnableFavoritesPlaylist=True, EnableDislikesPlaylist=True, FavoritesPlaylistName="Favoriten",
                DislikesPlaylistName="Dislikes", AutoPlaylistNewestFirst=True)
    keys = list(base)

    def configure(**changes):
        # Merge into the live configuration: it carries the registry of the automatic playlists.
        current = admin.get(f"/Plugins/{PLUGIN_ID}/Configuration").json()
        resp = admin.post(f"/Plugins/{PLUGIN_ID}/Configuration", dict(current, **dict(base, **changes)))
        assert resp.status in (200, 204), resp.text()

    marked = []  # (client, item id, kind) to undo in the end

    def heart(client, item_id):
        marked.append((client, item_id, "heart"))
        return set_heart(client, item_id)

    def dislike(client, item_id):
        marked.append((client, item_id, "dislike"))
        return set_dislike(client, item_id)

    s = [nodash(i["Id"]) for i in small[:6]]
    d = [nodash(i["Id"]) for i in small[20:26]]
    try:
        # a clean start: no marks of earlier runs
        for client in (alice, bob, dave):
            for item in client.get("/Items", params={"Recursive": "true", "Filters": "IsFavorite", "UserId": client.user_id, "Limit": "5000"}).json()["Items"]:
                set_heart(client, item["Id"], False)
        configure(EnableFavoritesPlaylist=False, EnableDislikesPlaylist=False)

        # AP1
        wait_until(lambda: "PlaylistId" not in auto_state(alice)["Favorites"], timeout=wait, step=0.5)
        st = auto_state(alice)
        heart(alice, s[0])
        time.sleep(delay + 3)
        listed = admin.get("/PlaylistToolkit/Admin/Playlists").json()
        check("AP1 both kinds off: nothing enabled, no id, a heart creates no playlist",
              not st["Favorites"]["Enabled"] and not st["Dislikes"]["Enabled"] and "PlaylistId" not in st["Favorites"] and "PlaylistId" not in st["Dislikes"]
              and not any(p.get("AutoKind") for p in listed), str(st))
        set_heart(alice, s[0], False)

        # AP2
        configure()
        resp = alice.post("/PlaylistToolkit/AutoPlaylists/Sync")
        st = resp.json()
        check("AP2 both on, no marks: both playlists exist from the start, empty",
              resp.status == 200 and st["Favorites"]["Enabled"] and "PlaylistId" in st["Favorites"] and "PlaylistId" in st["Dislikes"]
              and st["Favorites"]["ItemCount"] == 0 and st["Dislikes"]["ItemCount"] == 0, resp.text())
        empty_pid = nodash(st["Favorites"]["PlaylistId"])
        check("AP2 the empty 'Favoriten' is listed in the stock playlist list and shows an empty table",
              any(nodash(p["Id"]) == empty_pid and p["Name"] == "Favoriten" for p in stock_playlists(alice))
              and alice.get(f"/PlaylistToolkit/Playlists/{empty_pid}/Items").json()["Items"] == [])

        # AP3
        heart(alice, s[0])
        ok = wait_items(alice, "Favorites", [s[0]], wait)
        fav = auto_pid(alice, "Favorites")
        names = [p["Name"] for p in stock_playlists(alice) if nodash(p["Id"]) == fav]
        check("AP3 a heart creates 'Favoriten' in the stock playlist list with exactly that song", ok and names == ["Favoriten"], f"{fav} {names}")

        # AP4
        heart(alice, s[1])
        ok2 = wait_items(alice, "Favorites", [s[1], s[0]], wait)
        heart(alice, s[2])
        ok3 = wait_items(alice, "Favorites", [s[2], s[1], s[0]], wait)
        check("AP4 newest heart on top", ok2 and ok3)

        # AP5
        set_heart(alice, s[1], False)
        check("AP5 removing a heart removes the song, order kept", wait_items(alice, "Favorites", [s[2], s[0]], wait))
        heart(alice, s[1])
        wait_items(alice, "Favorites", [s[1], s[2], s[0]], wait)

        # AP6
        dislike(alice, d[0])
        ok = wait_items(alice, "Dislikes", [d[0]], wait)
        dpid = auto_pid(alice, "Dislikes")
        set_dislike(alice, d[0], False)
        ok2 = wait_items(alice, "Dislikes", [], wait)
        check("AP6 a dislike creates 'Dislikes'; clearing it keeps the empty playlist with the same id",
              ok and ok2 and auto_pid(alice, "Dislikes") == dpid and dpid is not None, f"{dpid} {auto_pid(alice, 'Dislikes')}")
        for x in d[:3]:
            dislike(alice, x)
        wait_items(alice, "Dislikes", [d[2], d[1], d[0]], wait)

        # AP7
        pid = fav
        some = small[30]["Id"]
        entries = alice.get(f"/Playlists/{pid}/Items", params={"userId": alice.user_id}).json()["Items"]
        first_entry = entries[0]["PlaylistItemId"]
        refused = {
            "stock add": alice.post(f"/Playlists/{pid}/Items", params={"ids": some, "userId": alice.user_id}).status,
            "stock remove": alice.delete(f"/Playlists/{pid}/Items", params={"entryIds": first_entry}).status,
            "stock move": alice.post(f"/Playlists/{pid}/Items/{first_entry}/Move/1").status,
            "stock rename": alice.post(f"/Playlists/{pid}", {"Name": "T-Renamed"}).status,
            "stock delete": alice.delete(f"/Items/{pid}").status,
        }
        for who, client in (("user", alice), ("admin", admin)):
            refused[f"plugin add {who}"] = client.post(f"/PlaylistToolkit/Playlists/{pid}/Items", {"Ids": [some]}).status
            refused[f"plugin remove {who}"] = client.delete(f"/PlaylistToolkit/Playlists/{pid}/Items", params={"entryIds": first_entry}).status
            refused[f"plugin move {who}"] = client.post(f"/PlaylistToolkit/Playlists/{pid}/Items/{first_entry}/Move/1").status
            refused[f"plugin share {who}"] = client.post(f"/PlaylistToolkit/Playlists/{pid}/Sharing", {"OpenAccess": True}).status
            refused[f"plugin import {who}"] = client.post("/PlaylistToolkit/Import", {"PlaylistId": pid, "Content": "#EXTM3U\n"}).status
        share = alice.get(f"/Playlists/{pid}/Users/{alice.user_id}")
        check("AP7 automatic playlist is read-only on the stock API and the plugin API (also for the administrator)",
              all(v == 403 for k, v in refused.items() if k != 'stock delete') and refused['stock delete'] in (401, 403, 404) and playlist_ids(alice, pid) == [s[1], s[2], s[0]]
              and share.status == 200 and share.json()["CanEdit"] is False, str(refused))

        # AP8
        check("AP8 other users do not see it", all(nodash(p["Id"]) != pid for p in stock_playlists(bob))
              and bob.get(f"/PlaylistToolkit/Playlists/{pid}").status == 404)
        listed = admin.get("/PlaylistToolkit/Admin/Playlists").json()
        mine = [p for p in listed if nodash(p["Id"]) == pid]
        check("AP8 administrator: stock 404, plugin admin list shows it with kind and user",
              admin.get(f"/Playlists/{pid}").status == 404 and len(mine) == 1 and mine[0]["AutoKind"] == "Favorites"
              and mine[0]["AutoUserName"] == "alice", str(mine))

        # AP9
        info = alice.get(f"/PlaylistToolkit/Playlists/{pid}").json()
        check("AP9 rights of the user it belongs to",
              info["AutoKind"] == "Favorites" and info["IsAutoSubject"] is True and info["CanEditItems"] is False
              and info["CanShare"] is False and info["CanManage"] is True and info["IsOwner"] is False, str(info))
        ainfo = admin.get(f"/PlaylistToolkit/Playlists/{pid}").json()
        check("AP9 administrator view is read-only too", ainfo["AutoKind"] == "Favorites" and ainfo["IsAutoSubject"] is False
              and not ainfo["CanEditItems"] and not ainfo["CanShare"] and ainfo["CanManage"])

        # AP10
        heart(bob, s[0])
        wait_items(bob, "Favorites", [s[0]], wait)
        bpid = auto_pid(bob, "Favorites")
        check("AP10 another user gets an own playlist; the first user's is unchanged",
              bpid and bpid != pid and playlist_ids(alice, pid) == [s[1], s[2], s[0]])

        # AP11
        album_id = alice.get(f"/Items/{small[0]['Id']}", params={"UserId": alice.user_id}).json()["AlbumId"]
        set_heart(alice, album_id)
        marked.append((alice, album_id, "heart"))
        time.sleep(delay + 4)
        unchanged = playlist_ids(alice, pid) == [s[1], s[2], s[0]]
        resp = alice.post(f"/UserItems/{s[3]}/UserData", {"IsFavorite": True})
        marked.append((alice, s[3], "heart"))
        via_userdata = resp.status in (200, 204) and wait_items(alice, "Favorites", [s[3], s[1], s[2], s[0]], wait)
        check("AP11 a favourite album changes nothing; a heart set through the user data endpoint appears",
              unchanged and via_userdata, f"unchanged={unchanged} userdata={resp.status}")
        set_heart(alice, album_id, False)

        # AP12
        a = alice.post("/PlaylistToolkit/AutoPlaylists/Sync").json()
        b = alice.post("/PlaylistToolkit/AutoPlaylists/Sync").json()
        rows = playlist_ids(alice, pid)
        check("AP12 sync twice: same id, same entries, no duplicates",
              a == b and nodash(a["Favorites"]["PlaylistId"]) == pid and rows == [s[3], s[1], s[2], s[0]] and len(set(rows)) == len(rows))

        # AP13
        thirty = [nodash(i["Id"]) for i in bulk[:30]]
        for x in thirty:
            heart(bob, x)
        ok = wait_until(lambda: sorted(playlist_ids(bob, bpid) or []) == sorted(thirty + [s[0]]), timeout=wait, step=0.5)
        rows = playlist_ids(bob, bpid)
        check("AP13 30 hearts in a row: all present exactly once", ok and len(rows) == len(set(rows)) == 31, str(len(rows or [])))

        # AP21
        t0 = time.time()
        heart(bob, nodash(bulk[40]["Id"]))
        ok = wait_until(lambda: nodash(bulk[40]["Id"]) in (playlist_ids(bob, bpid) or []), timeout=wait, step=0.1)
        took = time.time() - t0
        check("AP21 time from heart to playlist entry is below the delay plus 5 s", ok and took < delay + 5, f"{took:.1f} s")

        # AP18
        resp = alice.get("/Items", params={"ParentId": pid, "SortBy": "Random", "UserId": alice.user_id, "Limit": "50"})
        got = sorted(nodash(i["Id"]) for i in resp.json()["Items"])
        check("AP18 stock shuffle query on the playlist returns the favourites", resp.status == 200 and got == sorted([s[3], s[1], s[2], s[0]]), str(got))

        # AP17
        resp = alice.get(f"/PlaylistToolkit/Playlists/{dpid}/SmartShuffle")
        got = sorted(nodash(x) for x in resp.json()["ItemIds"]) if resp.status == 200 else []
        check("AP17 smart shuffle on 'Dislikes' returns its 3 songs", got == sorted(d[:3]), str(resp.text()[:200]))

        # AP15
        configure(FavoritesPlaylistName="T-Favs")
        ok = wait_until(lambda: [p["Name"] for p in stock_playlists(alice) if nodash(p["Id"]) == pid] == ["T-Favs"], timeout=wait, step=0.5)
        check("AP15 a changed name renames the existing playlist (same id)", ok and auto_pid(alice, "Favorites") == pid)
        configure()
        wait_until(lambda: [p["Name"] for p in stock_playlists(alice) if nodash(p["Id"]) == pid] == ["Favoriten"], timeout=wait, step=0.5)

        # AP16
        configure(AutoPlaylistNewestFirst=False)
        heart(alice, s[4])
        ok = wait_items(alice, "Favorites", [s[3], s[1], s[2], s[0], s[4]], wait)
        check("AP16 newest-first off: a new heart is the last entry", ok)
        configure()

        # AP14
        before = playlist_ids(alice, pid)
        resp = admin.delete(f"/Items/{pid}")
        still = playlist_ids(alice, pid) == before
        check("AP14 the stock delete of an administrator does not reach it (the administrator cannot see it)", resp.status in (401, 403, 404) and still, f"delete={resp.status}")
        # A lost registry entry is healed by adoption: same playlist, no second one.
        current = admin.get(f"/Plugins/{PLUGIN_ID}/Configuration").json()
        admin.post(f"/Plugins/{PLUGIN_ID}/Configuration", dict(current, AutoPlaylists=[]))
        time.sleep(delay + 4)
        alice.post("/PlaylistToolkit/AutoPlaylists/Sync")
        mine = [p for p in stock_playlists(alice) if p["Name"] == "Favoriten"]
        check("AP14 an emptied registry is healed by adoption: same playlist id, no second playlist",
              auto_pid(alice, "Favorites") == pid and len(mine) == 1 and playlist_ids(alice, pid) == before, f"{auto_pid(alice, 'Favorites')} {len(mine)}")

        # AP19
        tasks = admin.get("/ScheduledTasks").json()
        task = next((t for t in tasks if t["Key"] == "PlaylistToolkitAutoPlaylists"), None)
        done = False
        if task:
            admin.post(f"/ScheduledTasks/Running/{task['Id']}")
            def finished():
                t = next(t for t in admin.get("/ScheduledTasks").json() if t["Key"] == "PlaylistToolkitAutoPlaylists")
                return t["State"] == "Idle" and (t.get("LastExecutionResult") or {}).get("Status") == "Completed"
            done = wait_until(finished, timeout=60, step=0.5)
        check("AP19 scheduled task exists, runs and completes", task is not None and done)

        # AP20
        name = "pt-temp-auto"
        created = admin.post("/Users/New", {"Name": name, "Password": jf.new_password()})
        temp_pid = None
        if created.status == 200:
            temp_id = created.json()["Id"]
            # no known password for the new user: use the user data endpoint of the administrator? Not possible, so set a password first.
            password = jf.new_password()
            admin.post(f"/Users/{temp_id}/Password", {"NewPw": password})
            temp = jf.Client(name)
            auth = temp.post("/Users/AuthenticateByName", {"Username": name, "Pw": password})
            if auth.status == 200:
                temp.token = auth.json()["AccessToken"]
                temp.user_id = auth.json()["User"]["Id"]
                temp.get("/PlaylistToolkit/Config")
                both = wait_until(lambda: "PlaylistId" in auto_state(temp)["Favorites"] and "PlaylistId" in auto_state(temp)["Dislikes"], timeout=wait, step=0.5)
                check("AP26 a new user gets both (empty) playlists after the first request of the web client", both, str(auto_state(temp)))
                set_heart(temp, s[0])
                temp.post("/PlaylistToolkit/AutoPlaylists/Sync")
                temp_pid = auto_pid(temp, "Favorites")
            admin.delete(f"/Users/{temp_id}")
        if temp_pid:
            task = next(t for t in admin.get("/ScheduledTasks").json() if t["Key"] == "PlaylistToolkitAutoPlaylists")
            admin.post(f"/ScheduledTasks/Running/{task['Id']}")
            time.sleep(3)
            wait_until(lambda: all(nodash(p["Id"]) != temp_pid for p in admin.get("/PlaylistToolkit/Admin/Playlists").json()), timeout=60, step=1)
        gone = temp_pid is not None and all(nodash(p["Id"]) != temp_pid for p in admin.get("/PlaylistToolkit/Admin/Playlists").json())
        check("AP20 the automatic playlist of a deleted user is removed by the task", gone, str(temp_pid))

        # AP23 fixed images
        def primary(client, pid_):
            item = client.get(f"/Items/{pid_}", params={"UserId": client.user_id}).json()
            if "Primary" not in item.get("ImageTags", {}):
                return None
            img = client.get(f"/Items/{pid_}/Images/Primary")
            return img.body if img.status == 200 else None

        ok = wait_until(lambda: primary(alice, pid) is not None, timeout=wait + 5, step=0.5)
        fav_img = primary(alice, pid)
        check("AP23 'Favoriten' has the fixed image (PNG, 800x800)", ok and fav_img[:8] == b"\x89PNG\r\n\x1a\n" and fav_img[16:24] == bytes.fromhex("00000320") + bytes.fromhex("00000320"), str(len(fav_img or b"")))
        ok = wait_until(lambda: primary(alice, dpid) is not None, timeout=wait + 5, step=0.5)
        dis_img = primary(alice, dpid)
        check("AP23 'Dislikes' has its own fixed image, different from 'Favoriten'", ok and dis_img[:8] == b"\x89PNG\r\n\x1a\n" and dis_img != fav_img, str(len(dis_img or b"")))

        # AP24 a custom image stays
        custom = make_image("jpg", 128, "blue")
        resp = alice.request("POST", f"/PlaylistToolkit/Playlists/{pid}/Image", raw=custom, content_type="image/jpeg")
        alice.post("/PlaylistToolkit/AutoPlaylists/Sync")
        heart(alice, s[5])
        wait_items(alice, "Favorites", [s[5], s[3], s[1], s[2], s[0], s[4]], wait)
        time.sleep(delay + 3)
        alice.post("/PlaylistToolkit/AutoPlaylists/Sync")
        task = next((t for t in admin.get("/ScheduledTasks").json() if t["Key"] == "PlaylistToolkitAutoPlaylists"), None)
        admin.post(f"/ScheduledTasks/Running/{task['Id']}")
        time.sleep(delay + 4)
        kept = primary(alice, pid)
        check("AP24 an image set by the user stays after sync, new heart and the daily task", resp.status == 204 and kept is not None and kept[:3] == b"\xff\xd8\xff" and kept != fav_img, f"{resp.status} {len(kept or b'')}")
        # AP25 removing it brings the fixed image back
        alice.delete(f"/PlaylistToolkit/Playlists/{pid}/Image")
        alice.post("/PlaylistToolkit/AutoPlaylists/Sync")
        ok = wait_until(lambda: primary(alice, pid) == fav_img, timeout=wait + 10, step=0.5)
        check("AP25 after removing the custom image the fixed image comes back", ok)
        set_heart(alice, s[5], False)

        # AP22
        configure(EnableDislikesPlaylist=False)
        ok = wait_until(lambda: "PlaylistId" not in auto_state(alice)["Dislikes"], timeout=wait, step=0.5)
        # every user's playlist goes in one run; wait for the last one before looking at the list
        wait_until(lambda: not any(p.get("AutoKind") == "Dislikes" for p in admin.get("/PlaylistToolkit/Admin/Playlists").json()), timeout=wait, step=0.5)
        listed = admin.get("/PlaylistToolkit/Admin/Playlists").json()
        check("AP22 'Dislikes' switched off: its playlists are gone, 'Favoriten' is untouched",
              ok and not any(p.get("AutoKind") == "Dislikes" for p in listed) and auto_pid(alice, "Favorites") == pid
              and any(p.get("AutoKind") == "Favorites" for p in listed))
        configure()
    finally:
        for client, item_id, kind in marked:
            (set_heart if kind == "heart" else set_dislike)(client, item_id, False)
        current = admin.get(f"/Plugins/{PLUGIN_ID}/Configuration").json()
        admin.post(f"/Plugins/{PLUGIN_ID}/Configuration", dict(current, **{k: settings[k] for k in keys}))
        time.sleep(delay + 3)


def membership(admin, alice, bob, small):
    """TM1 to TM8: rows carry the heart; the targets list and the one-call membership change."""
    ids = [i["Id"] for i in small]
    a = create_playlist(alice, "T-Mem-A", ids[:3])
    b = create_playlist(alice, "T-Mem-B", ids[3:5])
    bobs = create_playlist(bob, "T-Mem-Bob", ids[:2])
    listen = create_playlist(bob, "T-Mem-Listen", ids[:2])
    editable = create_playlist(bob, "T-Mem-Edit", ids[:2])
    alice_id = alice.user_id
    bob.post(f"/PlaylistToolkit/Playlists/{listen}/Sharing", {"Shares": [{"UserId": alice_id, "CanEdit": False}]})
    bob.post(f"/PlaylistToolkit/Playlists/{editable}/Sharing", {"Shares": [{"UserId": alice_id, "CanEdit": True}]})
    track = ids[0]
    try:
        for item in alice.get("/Items", params={"Recursive": "true", "Filters": "IsFavorite", "UserId": alice.user_id, "Limit": "5000"}).json()["Items"]:
            set_heart(alice, item["Id"], False)
        set_heart(alice, track)
        rows = alice.get(f"/PlaylistToolkit/Playlists/{a}/Items").json()["Items"]
        by = {nodash(r["Id"]): r["IsFavorite"] for r in rows}
        check("TM1 table rows carry the caller's heart", by[nodash(ids[0])] is True and by[nodash(ids[1])] is False, str(by))
        set_dislike(alice, ids[1])
        rows = alice.get(f"/PlaylistToolkit/Playlists/{a}/Items").json()["Items"]
        by = {nodash(r["Id"]): (r["IsFavorite"], r["IsDisliked"]) for r in rows}
        check("TM1 table rows carry the caller's dislike (and only that user's)", by[nodash(ids[1])] == (False, True) and by[nodash(ids[0])] == (True, False)
              and not any(r["IsDisliked"] for r in bob.get(f"/PlaylistToolkit/Playlists/{bobs}/Items").json()["Items"]), str(by))
        set_dislike(alice, ids[1], False)
        rows_bob = bob.get(f"/PlaylistToolkit/Playlists/{bobs}/Items").json()["Items"]
        check("TM1 the heart is the caller's own: bob's rows show none", not any(r["IsFavorite"] for r in rows_bob))

        targets = alice.get("/PlaylistToolkit/Targets", params={"itemId": track}).json()
        names = {t["Name"]: t for t in targets}
        check("TM2 targets: own playlists and ones shared with edit right; no foreign, listen-only or automatic ones",
              "T-Mem-A" in names and "T-Mem-B" in names and "T-Mem-Edit" in names and "T-Mem-Bob" not in names
              and "T-Mem-Listen" not in names and "Favoriten" not in names and "Dislikes" not in names, str(sorted(names)))
        check("TM2 targets say where the track already is", names["T-Mem-A"]["Contains"] is True and names["T-Mem-B"]["Contains"] is False
              and names["T-Mem-Edit"]["Contains"] is True and names["T-Mem-Edit"]["OwnerName"] == "bob")
        check("TM2 targets of an unknown track: 404", alice.get("/PlaylistToolkit/Targets", params={"itemId": "00000000000000000000000000000001"}).status == 404)

        resp = alice.post("/PlaylistToolkit/Membership", {"ItemId": track, "Add": [b, bobs, listen], "Remove": [a]})
        res = resp.json()
        check("TM3 one call adds and removes; playlists without edit right are reported and left alone",
              resp.status == 200 and [nodash(x) for x in res["Added"]] == [nodash(b)] and [nodash(x) for x in res["Removed"]] == [nodash(a)]
              and sorted(nodash(x) for x in res["Failed"]) == sorted([nodash(bobs), nodash(listen)]), resp.text())
        check("TM3 the playlists changed as asked",
              nodash(track) in playlist_ids(alice, b) and nodash(track) not in playlist_ids(alice, a)
              and nodash(track) in playlist_ids(bob, bobs) and nodash(track) in playlist_ids(bob, listen))
        # nothing happens twice
        res = alice.post("/PlaylistToolkit/Membership", {"ItemId": track, "Add": [b], "Remove": []}).json()
        check("TM4 adding where the track already is adds no second entry", playlist_ids(alice, b).count(nodash(track)) == 1 and res["Failed"] == [])
        # automatic playlist and a shared one with edit right
        alice.post("/PlaylistToolkit/AutoPlaylists/Sync")
        fav = auto_pid(alice, "Favorites")
        res = alice.post("/PlaylistToolkit/Membership", {"ItemId": track, "Add": [fav], "Remove": [fav]}).json()
        res2 = alice.post("/PlaylistToolkit/Membership", {"ItemId": ids[5], "Add": [editable], "Remove": []}).json()
        check("TM5 an automatic playlist is never changed; a playlist shared with edit right is",
              nodash(fav) in [nodash(x) for x in res["Failed"]] and nodash(ids[5]) in playlist_ids(bob, editable) and res2["Failed"] == [])
        res = alice.post("/PlaylistToolkit/Membership", {"ItemId": track, "Add": [], "Remove": [editable, a]}).json()
        check("TM6 removing works in a shared playlist; where the track is not it does no harm",
              res["Failed"] == [] and nodash(track) not in playlist_ids(bob, editable) and len(playlist_ids(bob, editable)) == 2 and len(playlist_ids(alice, a)) == 2)
        check("TM7 the membership call needs a login and a known track",
              jf.Client().post("/PlaylistToolkit/Membership", {"ItemId": track}).status == 401
              and alice.post("/PlaylistToolkit/Membership", {"ItemId": "00000000000000000000000000000001"}).status == 404)
    finally:
        set_heart(alice, track, False)
        for client, pl in ((alice, a), (alice, b), (bob, bobs), (bob, listen), (bob, editable)):
            client.delete(f"/Items/{pl}")


def artist_sorting(admin, alice):
    """AS1 to AS4: artists with a leading article sort without it; look-alikes stay."""
    cfg = alice.get("/PlaylistToolkit/Config").json()
    check("AS1 the client gets the list of articles", cfg.get("SortArticles") == ["The", "Die"], str(cfg.get("SortArticles")))
    def sort_names():
        items = alice.get("/Artists", params={"UserId": alice.user_id, "SortBy": "SortName", "Fields": "SortName", "Limit": "1000"}).json()["Items"]
        return {i["Name"]: i["SortName"] for i in items}, [i["Name"] for i in items]
    names, order = sort_names()
    check("AS2 'Die' is sorted without the article, 'The' too",
          names.get("Die Testband") == "testband" and names.get("The Test Band") == "test band", str({k: names.get(k) for k in ("Die Testband", "The Test Band")}))
    check("AS3 'Diesel', 'Theory' and a bare 'The' are left alone",
          names.get("Diesel Test") == "diesel test" and names.get("Theory Test") == "theory test" and names.get("The") == "the", str({k: names.get(k) for k in ("Diesel Test", "Theory Test", "The")}))
    check("AS4 the artist list is ordered by the sort name", order.index("The Test Band") < order.index("Die Testband") < order.index("Theory Test"))
    tasks = admin.get("/ScheduledTasks").json()
    task = next((t for t in tasks if t["Key"] == "PlaylistToolkitArtistSort"), None)
    ran = False
    if task:
        admin.post(f"/ScheduledTasks/Running/{task['Id']}")
        ran = wait_until(lambda: next(t for t in admin.get("/ScheduledTasks").json() if t["Key"] == "PlaylistToolkitArtistSort")["State"] == "Idle", timeout=60, step=0.5)
    check("AS5 the scheduled task exists and runs", task is not None and ran and sort_names()[0].get("Die Testband") == "testband")


def marks_during_playback(alice, small):
    """PB1: a heart or dislike set while the song plays is not wiped by the playback reports (Jellyfin 12.4 does that)."""
    def marks(i):
        d = alice.get(f"/Items/{i}", params={"UserId": alice.user_id}).json()["UserData"]
        return d.get("IsFavorite"), d.get("Likes")
    def play(i, act):
        alice.post("/Sessions/Playing", {"ItemId": i, "PositionTicks": 0, "CanSeek": True, "PlayMethod": "DirectPlay"})
        act()
        time.sleep(0.4)
        for pos in (10000000, 20000000):
            alice.post("/Sessions/Playing/Progress", {"ItemId": i, "PositionTicks": pos, "IsPaused": False, "PlayMethod": "DirectPlay"})
            time.sleep(0.5)
        alice.post("/Sessions/Playing/Stopped", {"ItemId": i, "PositionTicks": 30000000})
        time.sleep(0.8)
    heart_id, dis_id = small[10]["Id"], small[11]["Id"]
    try:
        play(heart_id, lambda: set_heart(alice, heart_id))
        play(dis_id, lambda: set_dislike(alice, dis_id))
        check("PB1 a heart and a dislike set while the song plays survive progress and stop reports", marks(heart_id)[0] is True and marks(dis_id)[1] is False,
              f"{marks(heart_id)} {marks(dis_id)}")
        set_heart(alice, heart_id, False)
        alice.post("/Sessions/Playing", {"ItemId": heart_id, "PositionTicks": 0, "CanSeek": True, "PlayMethod": "DirectPlay"})
        alice.post("/Sessions/Playing/Stopped", {"ItemId": heart_id, "PositionTicks": 30000000})
        time.sleep(0.8)
        check("PB2 taking a heart back explicitly sticks (the guard does not bring it back)", marks(heart_id)[0] is False)
    finally:
        for i in (heart_id, dis_id):
            set_heart(alice, i, False)
            set_dislike(alice, i, False)


def coexistence(admin, alice, anon, settings, small):
    """CX1 to CX3: needs the Dislike plugin next to this one (DISLIKE_BUILD=... ./testserver/deploy.sh)."""
    present = alice.get("/Dislike/Config").status == 200
    if not present:
        for name in ("CX1", "CX2", "CX3"):
            print(f"SKIP  {name} (Dislike plugin not installed)")
        return
    delay = settings.get("AutoPlaylistSyncDelaySeconds", 2)
    wait = delay + 10
    index = anon.get("/web/index.html").text()
    check("CX3 index.html carries both script tags and both config routes answer",
          "data-playlisttoolkit" in index and "data-dislike" in index
          and alice.get("/PlaylistToolkit/Config").status == 200 and alice.get("/Dislike/Config").status == 200)
    song = nodash(small[45]["Id"])
    current = admin.get(f"/Plugins/{PLUGIN_ID}/Configuration").json()
    admin.post(f"/Plugins/{PLUGIN_ID}/Configuration", dict(current, EnableFavoritesPlaylist=True, EnableDislikesPlaylist=True))
    try:
        set_heart(alice, song)
        in_fav = wait_items(alice, "Favorites", [song], wait)
        set_dislike(alice, song)
        left = wait_until(lambda: playlist_ids(alice, auto_pid(alice, "Favorites")) == [], timeout=wait, step=0.3)
        entered = wait_items(alice, "Dislikes", [song], wait)
        set_heart(alice, song)
        back = wait_items(alice, "Favorites", [song], wait)
        gone = wait_items(alice, "Dislikes", [], wait)
        check("CX1 with the exclusion: a dislike moves the song from 'Favoriten' to 'Dislikes', a heart moves it back",
              in_fav and left and entered and back and gone, f"{in_fav} {left} {entered} {back} {gone}")
    finally:
        set_heart(alice, song, False)
        set_dislike(alice, song, False)
    print("SKIP  CX2 (needs the Dislike plugin with review lists, part B; not implemented)")


def main():
    alice, bob, carol, dave, admin = (jf.login(n) for n in ("alice", "bob", "carol", "dave", "testadmin"))
    anon = jf.Client()
    delete_test_playlists([alice, bob, carol, dave, admin])

    small = [i for i in audio_items(alice) if "/small/" in i["Path"]]
    bulk = [i for i in audio_items(alice) if "/bulk/" in i["Path"]]
    check("test library present", len(small) == 49 and len(bulk) >= 2500, f"small={len(small)} bulk={len(bulk)}")
    me = alice.get("/Users/Me").json()
    check("owner under test is not an administrator", me["Policy"]["IsAdministrator"] is False)

    # ---------------------------------------------------------------- script injection
    index = anon.get("/web/index.html")
    check("index.html carries the script tag", index.status == 200 and index.text().count("data-playlisttoolkit") == 1)
    check("index.html is not cached without revalidation", index.headers.get("Cache-Control") == "no-cache" and "ETag" not in index.headers)
    compressed = anon.get("/web/", headers={"Accept-Encoding": "gzip, br"})
    check("injection also works when the browser accepts compression", "data-playlisttoolkit" in compressed.text())
    conditional = anon.get("/web/index.html", headers={"If-Modified-Since": "Wed, 18 Nov 2026 00:00:00 GMT"})
    check("conditional request still returns the injected document", conditional.status == 200 and "data-playlisttoolkit" in conditional.text())
    script = anon.get("/PlaylistToolkit/ClientScript")
    check("client script is served without login", script.status == 200 and "javascript" in script.headers.get("Content-Type", ""))
    other = anon.get("/web/manifest.json")
    check("other web files are untouched", other.status == 200 and "playlisttoolkit" not in other.text())
    check("API needs a login", anon.get("/PlaylistToolkit/Config").status == 401)

    # ---------------------------------------------------------------- plugin settings
    settings = admin.get(f"/Plugins/{PLUGIN_ID}/Configuration").json()
    check("normal user cannot read or change the plugin settings",
          alice.get(f"/Plugins/{PLUGIN_ID}/Configuration").status == 403
          and alice.post(f"/Plugins/{PLUGIN_ID}/Configuration", dict(settings, EditorsCanEditDetails=True)).status == 403)
    try:
        admin.post(f"/Plugins/{PLUGIN_ID}/Configuration", dict(settings, InjectClientScript=False, EnableTrackTable=False))
        check("script injection can be switched off", "data-playlisttoolkit" not in anon.get("/web/index.html").text())
        check("track table switch reaches the client", alice.get("/PlaylistToolkit/Config").json()["EnableTrackTable"] is False)
    finally:
        admin.post(f"/Plugins/{PLUGIN_ID}/Configuration", settings)
    check("settings restored", "data-playlisttoolkit" in anon.get("/web/index.html").text())

    # ---------------------------------------------------------------- playlist under test
    ids = [i["Id"] for i in small[:12]]
    pid = create_playlist(alice, "T-Owner", ids)
    info = alice.get(f"/PlaylistToolkit/Playlists/{pid}").json()
    check("owner sees own private playlist with full rights",
          info["IsOwner"] and info["CanManage"] and info["CanShare"] and info["CanEditItems"] and not info["OpenAccess"], str(info))
    check("other user cannot see a private playlist", bob.get(f"/PlaylistToolkit/Playlists/{pid}").status == 404)
    check("a normal user the playlist is not shared with cannot see it", dave.get(f"/PlaylistToolkit/Playlists/{pid}").status == 404)
    admin_private = admin.get(f"/PlaylistToolkit/Playlists/{pid}")
    check("administrator reaches a private playlist of another user with all rights (stock API hides it from them)",
          admin_private.status == 200 and admin.get(f"/Playlists/{pid}").status == 404
          and all(admin_private.json()[k] for k in ("CanEditItems", "CanManage", "CanShare")) and not admin_private.json()["IsOwner"],
          admin_private.text()[:200])
    check("unknown playlist id gives 404", alice.get("/PlaylistToolkit/Playlists/00000000000000000000000000000001").status == 404)

    # ---------------------------------------------------------------- 1. image
    png, jpg = make_image("png"), make_image("jpg", color="blue")
    stock = alice.post(f"/Items/{pid}/Images/Primary", raw=png, content_type="image/png")
    check("stock image upload is refused for the owner (the gap this plugin closes)", stock.status == 403, f"status {stock.status}")
    resp = alice.post(f"/PlaylistToolkit/Playlists/{pid}/Image", raw=png, content_type="image/png")
    check("owner sets playlist image (png)", resp.status == 204, f"status {resp.status} {resp.text()[:100]}")
    served = alice.get(f"/Items/{pid}/Images/Primary", params={"format": "Png"})
    check("image is served by the stock image endpoint", served.status == 200 and served.headers.get("Content-Type", "").startswith("image/"))
    tag1 = alice.get(f"/Items/{pid}", params={"UserId": alice.user_id}).json().get("ImageTags", {}).get("Primary")
    resp = alice.post(f"/PlaylistToolkit/Playlists/{pid}/Image", raw=jpg, content_type="image/jpeg")
    tag2 = alice.get(f"/Items/{pid}", params={"UserId": alice.user_id}).json().get("ImageTags", {}).get("Primary")
    check("owner replaces playlist image (jpeg)", resp.status == 204 and tag1 and tag2 and tag1 != tag2, f"{tag1} -> {tag2}")
    check("wrong content type is rejected", alice.post(f"/PlaylistToolkit/Playlists/{pid}/Image", raw=png, content_type="text/plain").status in (400, 415))
    check("non-image body is rejected", alice.post(f"/PlaylistToolkit/Playlists/{pid}/Image", raw=b"x" * 500, content_type="image/png").status == 400)
    limit = alice.get("/PlaylistToolkit/Config").json()["MaxImageBytes"]
    too_big = png + b"\0" * (limit + 1 - len(png))
    check("oversized image is rejected", alice.post(f"/PlaylistToolkit/Playlists/{pid}/Image", raw=too_big, content_type="image/png").status == 413)
    check("user without access cannot set the image", bob.post(f"/PlaylistToolkit/Playlists/{pid}/Image", raw=png, content_type="image/png").status == 404)

    # ---------------------------------------------------------------- 6. description
    text = "Quiet songs for the evening.\nSecond line with umlauts: äöü ß."
    resp = alice.post(f"/PlaylistToolkit/Playlists/{pid}/Description", {"Overview": text})
    check("owner sets description", resp.status == 204, f"status {resp.status}")
    check("description is visible through the stock item API",
          alice.get(f"/Items/{pid}", params={"UserId": alice.user_id}).json().get("Overview") == text)
    check("user without access cannot set the description", bob.post(f"/PlaylistToolkit/Playlists/{pid}/Description", {"Overview": "x"}).status == 404)
    max_len = alice.get("/PlaylistToolkit/Config").json()["MaxDescriptionLength"]
    check("overlong description is rejected", alice.post(f"/PlaylistToolkit/Playlists/{pid}/Description", {"Overview": "x" * (max_len + 1)}).status == 400)

    # Adding a track makes Jellyfin refresh the playlist metadata; image and description must survive.
    alice.post(f"/Playlists/{pid}/Items", params={"ids": small[20]["Id"], "userId": alice.user_id})
    time.sleep(6)
    after = alice.get(f"/Items/{pid}", params={"UserId": alice.user_id}).json()
    check("image and description survive a metadata refresh",
          after.get("Overview") == text and after.get("ImageTags", {}).get("Primary") == tag2, f"overview ok={after.get('Overview') == text}")

    # ---------------------------------------------------------------- 3. sharing
    stock_share = alice.post(f"/Playlists/{pid}/Users/{bob.user_id}", {"CanEdit": False})
    print(f"INFO  stock share endpoint on a private playlist answers {stock_share.status} (jellyfin#18534 expects 500)")
    resp = alice.post(f"/PlaylistToolkit/Playlists/{pid}/Sharing", {"Shares": [
        {"UserId": bob.user_id, "CanEdit": False}, {"UserId": carol.user_id, "CanEdit": True}]})
    shared = resp.json() if resp.status == 200 else {}
    check("owner shares a private playlist with two users", resp.status == 200 and len(shared.get("Shares", [])) == 2 and not shared.get("OpenAccess"), resp.text()[:200])
    bob_info = bob.get(f"/PlaylistToolkit/Playlists/{pid}").json()
    carol_info = carol.get(f"/PlaylistToolkit/Playlists/{pid}").json()
    check("listen-only user: sees it, may not edit, manage or share",
          not bob_info["CanEditItems"] and not bob_info["CanManage"] and not bob_info["CanShare"] and bob_info["Shares"] == [])
    check("editor: may edit tracks, may not manage or share (default setting)",
          carol_info["CanEditItems"] and not carol_info["CanManage"] and not carol_info["CanShare"])
    check("listen-only user can read tracks through the stock API", bob.get(f"/Playlists/{pid}/Items", params={"userId": bob.user_id}).status == 200)
    check("listen-only user cannot add tracks through the stock API",
          bob.post(f"/Playlists/{pid}/Items", params={"ids": small[30]["Id"], "userId": bob.user_id}).status == 403)
    check("editor can add tracks through the stock API",
          carol.post(f"/Playlists/{pid}/Items", params={"ids": small[30]["Id"], "userId": carol.user_id}).status == 204)
    time.sleep(6)  # the add above triggered a metadata refresh
    check("shares survive a metadata refresh",
          bob.get(f"/PlaylistToolkit/Playlists/{pid}").status == 200 and carol.get(f"/PlaylistToolkit/Playlists/{pid}").json()["CanEditItems"]
          and len(alice.get(f"/PlaylistToolkit/Playlists/{pid}").json()["Shares"]) == 2)
    check("shared playlist is still invisible to users it is not shared with", dave.get(f"/PlaylistToolkit/Playlists/{pid}").status == 404)
    check("listen-only user cannot change sharing", bob.post(f"/PlaylistToolkit/Playlists/{pid}/Sharing", {"Shares": []}).status == 403)
    check("editor cannot change sharing", carol.post(f"/PlaylistToolkit/Playlists/{pid}/Sharing", {"OpenAccess": True}).status == 403)
    check("listen-only user cannot set image", bob.post(f"/PlaylistToolkit/Playlists/{pid}/Image", raw=png, content_type="image/png").status == 403)
    check("editor cannot set image (default setting)", carol.post(f"/PlaylistToolkit/Playlists/{pid}/Image", raw=png, content_type="image/png").status == 403)
    check("listen-only user cannot set description", bob.post(f"/PlaylistToolkit/Playlists/{pid}/Description", {"Overview": "x"}).status == 403)
    check("listen-only user cannot delete image", bob.delete(f"/PlaylistToolkit/Playlists/{pid}/Image").status == 403)
    try:
        admin.post(f"/Plugins/{PLUGIN_ID}/Configuration", dict(settings, EditorsCanEditDetails=True))
        check("with the setting on, an editor may set the description but still not share",
              carol.post(f"/PlaylistToolkit/Playlists/{pid}/Description", {"Overview": text}).status == 204
              and carol.post(f"/PlaylistToolkit/Playlists/{pid}/Sharing", {"OpenAccess": True}).status == 403
              and bob.post(f"/PlaylistToolkit/Playlists/{pid}/Description", {"Overview": "x"}).status == 403)
    finally:
        admin.post(f"/Plugins/{PLUGIN_ID}/Configuration", settings)
    check("unknown user in share list is rejected",
          alice.post(f"/PlaylistToolkit/Playlists/{pid}/Sharing", {"Shares": [{"UserId": "00000000000000000000000000000009", "CanEdit": False}]}).status == 400)
    resp = alice.post(f"/PlaylistToolkit/Playlists/{pid}/Sharing", {"Shares": [{"UserId": carol.user_id, "CanEdit": False}]})
    check("owner removes a user and downgrades another",
          resp.status == 200 and bob.get(f"/PlaylistToolkit/Playlists/{pid}").status == 404
          and not carol.get(f"/PlaylistToolkit/Playlists/{pid}").json()["CanEditItems"])
    resp = alice.post(f"/PlaylistToolkit/Playlists/{pid}/Sharing", {"OpenAccess": True})
    check("owner makes the playlist public; shares are kept",
          resp.status == 200 and resp.json()["OpenAccess"] and len(resp.json()["Shares"]) == 1 and bob.get(f"/PlaylistToolkit/Playlists/{pid}").status == 200)
    alice.post(f"/PlaylistToolkit/Playlists/{pid}/Sharing", {"OpenAccess": False, "Shares": []})
    check("owner makes it private again", bob.get(f"/PlaylistToolkit/Playlists/{pid}").status == 404 and carol.get(f"/PlaylistToolkit/Playlists/{pid}").status == 404)
    users = alice.get("/PlaylistToolkit/Users").json()
    check("normal user gets the list of users to share with (hidden users included, self excluded)",
          sorted(u["Name"] for u in users) == ["bob", "carol", "dave", "testadmin"])
    check("user list exposes only id and name", all(set(u) == {"Id", "Name"} for u in users))
    # Jellyfin 12.4.0 hands the full stock user list (including each user's policy) to normal users, so
    # "normal users cannot list users" does not hold there. The plugin's list must never expose more than that.
    stock_users = alice.get("/Users")
    print(f"INFO  stock user list for a normal user answers {stock_users.status}")
    stock_fields = set().union(*(set(u) for u in stock_users.json())) if stock_users.status == 200 else set()
    check("the plugin's user list exposes nothing the stock API hides from a normal user",
          stock_users.status == 200 and {"Id", "Name"} <= stock_fields and {u["Id"] for u in users} <= {u["Id"] for u in stock_users.json()},
          "" if stock_users.status == 200 else
          f"stock /Users answers {stock_users.status}: this Jellyfin hides the user list from normal users, so /PlaylistToolkit/Users now shows more than stock - decide whether that is wanted")

    # ---------------------------------------------------------------- library access (carol may not use "Private Music")
    private = [i for i in audio_items(alice) if "/music-private/" in i["Path"]]
    private_ids = {i["Id"] for i in private}
    check("restricted test setup: the private library exists and is hidden from carol in stock browsing",
          len(private) == 7 and not any("/music-private/" in i["Path"] for i in audio_items(carol)), f"private={len(private)}")
    twin_open = next(i for i in small if i["Name"] == "Amber Song 12")
    twin_private = next(i for i in private if i["Name"] == "Amber Song 12")
    open_two = [i["Id"] for i in small if i["Name"] in ("Dusty Song 11", "Echo Song 11")]
    rid = create_playlist(alice, "T-Restricted", open_two + [i["Id"] for i in private])
    alice.post(f"/PlaylistToolkit/Playlists/{rid}/Sharing", {"Shares": [{"UserId": carol.user_id, "CanEdit": True}, {"UserId": bob.user_id, "CanEdit": False}]})
    rows_of = lambda client: [r["Id"] for r in client.get(f"/PlaylistToolkit/Playlists/{rid}/Items").json()["Items"]]
    check("owner and unrestricted user see all tracks of the shared playlist", len(rows_of(alice)) == 9 and len(rows_of(bob)) == 9)
    check("restricted user sees only tracks from libraries she may access", rows_of(carol) == open_two, f"{len(rows_of(carol))} rows")
    stock_carol = carol.get(f"/Playlists/{rid}/Items", params={"userId": carol.user_id}).json()
    print(f"INFO  stock playlist endpoint shows the restricted user {stock_carol['TotalRecordCount']} of 9 tracks")
    check("restricted user: smart shuffle contains no hidden track",
          sorted(carol.get(f"/PlaylistToolkit/Playlists/{rid}/SmartShuffle").json()["ItemIds"]) == sorted(open_two))
    carol_m3u = carol.get(f"/PlaylistToolkit/Playlists/{rid}/Export").text()
    check("restricted user: export contains no hidden track or path",
          carol_m3u.count("#EXTINF:") == 2 and not any(word in carol_m3u for word in ("music-private", "Secret", "Private Album")))
    resp = carol.post(f"/PlaylistToolkit/Playlists/{rid}/Duplicates", {"Ids": [twin_open["Id"], private[0]["Id"], twin_private["Id"]]})
    result = resp.json()
    check("restricted user: duplicate check neither expands hidden ids nor reports hidden entries",
          result["Total"] == 1 and result["Duplicates"] == [] and result["NewIds"] == [twin_open["Id"]]
          and not any(word in resp.text() for word in ("Secret", "Private Album")), resp.text()[:200])
    result = alice.post(f"/PlaylistToolkit/Playlists/{rid}/Duplicates", {"Ids": [twin_open["Id"]]}).json()
    check("the owner (with access) does get the 'similar' hint for the same song",
          [(d["Kind"], d["ExistingAlbum"]) for d in result["Duplicates"]] == [("similar", "Private Album")], str(result)[:200])
    secret_new = next(i for i in audio_items(alice) if i["Id"] in private_ids)
    resp = carol.post(f"/PlaylistToolkit/Playlists/{rid}/Items", {"Ids": [secret_new["Id"]]})
    check("restricted editor cannot add a hidden track by its id", resp.status == 200 and resp.json()["Added"] == 0 and len(rows_of(alice)) == 9, resp.text())
    resp = carol.post("/PlaylistToolkit/Import", {"Name": "T-Carol", "Content": "#EXTM3U\n#EXTINF:3,Secret Stag - Secret Song 1\n" + private[0]["Path"] + "\n"})
    check("restricted user: M3U import does not match hidden tracks", resp.status == 200 and resp.json()["Matched"] == 0, resp.text()[:200])

    # ---------------------------------------------------------------- administrator: everything, on every playlist
    aid = create_playlist(alice, "T-AdminTarget", [i["Id"] for i in small[:5]])
    listing = admin.get("/PlaylistToolkit/Admin/Playlists")
    entry = next((p for p in listing.json() if p["Id"] == aid), None) if listing.status == 200 else None
    check("administrator lists all playlists including private ones, with owner",
          entry is not None and entry["OwnerName"] == "alice" and not entry["OpenAccess"] and entry["ItemCount"] == 5 and entry["ShareCount"] == 0, str(entry))
    check("the list of all playlists is for administrators only",
          alice.get("/PlaylistToolkit/Admin/Playlists").status == 403 and anon.get("/PlaylistToolkit/Admin/Playlists").status == 401)
    check("client settings tell who is an administrator",
          admin.get("/PlaylistToolkit/Config").json()["IsAdministrator"] is True and alice.get("/PlaylistToolkit/Config").json()["IsAdministrator"] is False)
    check("administrator sets description and image of a private playlist of another user",
          admin.post(f"/PlaylistToolkit/Playlists/{aid}/Description", {"Overview": "set by admin"}).status == 204
          and admin.post(f"/PlaylistToolkit/Playlists/{aid}/Image", raw=png, content_type="image/png").status == 204
          and alice.get(f"/Items/{aid}", params={"UserId": alice.user_id}).json().get("Overview") == "set by admin"
          and alice.get(f"/PlaylistToolkit/Playlists/{aid}").json()["HasImage"])
    resp = admin.post(f"/PlaylistToolkit/Playlists/{aid}/Sharing", {"Shares": [{"UserId": bob.user_id, "CanEdit": False}]})
    check("administrator shares a private playlist of another user; the owner stays the owner",
          resp.status == 200 and bob.get(f"/PlaylistToolkit/Playlists/{aid}").status == 200
          and alice.get(f"/PlaylistToolkit/Playlists/{aid}").json()["IsOwner"] and resp.json()["OwnerName"] == "alice")
    admin_rows = lambda: admin.get(f"/PlaylistToolkit/Playlists/{aid}/Items").json()["Items"]
    before = [r["Id"] for r in admin_rows()]
    resp = admin.post(f"/PlaylistToolkit/Playlists/{aid}/Items", {"Ids": [small[10]["Id"]]})
    check("administrator adds a track to a private playlist of another user",
          resp.status == 200 and resp.json()["Added"] == 1 and [r["Id"] for r in admin_rows()] == before + [small[10]["Id"]])
    last = admin_rows()[-1]
    resp = admin.post(f"/PlaylistToolkit/Playlists/{aid}/Items/{last['PlaylistItemId']}/Move/0")
    check("administrator moves a track", resp.status == 204 and [r["Id"] for r in admin_rows()] == [small[10]["Id"]] + before, f"status {resp.status}")
    resp = admin.delete(f"/PlaylistToolkit/Playlists/{aid}/Items", params={"entryIds": last["PlaylistItemId"]})
    check("administrator removes a track", resp.status == 204 and [r["Id"] for r in admin_rows()] == before, f"status {resp.status}")
    check("administrator gets smart shuffle and export of that playlist",
          sorted(admin.get(f"/PlaylistToolkit/Playlists/{aid}/SmartShuffle").json()["ItemIds"]) == sorted(before)
          and admin.get(f"/PlaylistToolkit/Playlists/{aid}/Export").text().count("#EXTINF:") == 5)

    # Move and remove through the plugin for normal users: owner yes, listen-only no, stranger not found.
    first_row = alice.get(f"/PlaylistToolkit/Playlists/{aid}/Items").json()["Items"][0]
    check("listen-only user cannot move or remove tracks through the plugin",
          bob.post(f"/PlaylistToolkit/Playlists/{aid}/Items/{first_row['PlaylistItemId']}/Move/2").status == 403
          and bob.delete(f"/PlaylistToolkit/Playlists/{aid}/Items", params={"entryIds": first_row["PlaylistItemId"]}).status == 403)
    check("user without access cannot move or remove tracks through the plugin",
          dave.post(f"/PlaylistToolkit/Playlists/{aid}/Items/{first_row['PlaylistItemId']}/Move/2").status == 404
          and dave.delete(f"/PlaylistToolkit/Playlists/{aid}/Items", params={"entryIds": first_row["PlaylistItemId"]}).status == 404)
    resp = alice.post(f"/PlaylistToolkit/Playlists/{aid}/Items/{first_row['PlaylistItemId']}/Move/2")
    moved = [r["Id"] for r in alice.get(f"/PlaylistToolkit/Playlists/{aid}/Items").json()["Items"]]
    check("owner moves a track through the plugin", resp.status == 204 and moved == before[1:3] + [before[0]] + before[3:], f"status {resp.status}")
    resp = alice.delete(f"/PlaylistToolkit/Playlists/{aid}/Items", params={"entryIds": first_row["PlaylistItemId"]})
    check("owner removes a track through the plugin",
          resp.status == 204 and [r["Id"] for r in alice.get(f"/PlaylistToolkit/Playlists/{aid}/Items").json()["Items"]] == before[1:], f"status {resp.status}")
    remaining_rows = alice.get(f"/PlaylistToolkit/Playlists/{aid}/Items").json()["Items"]
    check("invalid move requests are rejected cleanly",
          alice.post(f"/PlaylistToolkit/Playlists/{aid}/Items/not-an-id/Move/0").status == 400
          and alice.post(f"/PlaylistToolkit/Playlists/{aid}/Items/{remaining_rows[0]['PlaylistItemId']}/Move/-1").status in (400, 404)
          and alice.post(f"/PlaylistToolkit/Playlists/{aid}/Items/{remaining_rows[0]['PlaylistItemId']}/Move/{len(remaining_rows)}").status == 400
          and alice.post(f"/PlaylistToolkit/Playlists/{aid}/Items/{remaining_rows[0]['PlaylistItemId']}/Move/9999").status == 400
          and alice.post(f"/PlaylistToolkit/Playlists/{aid}/Items/{first_row['PlaylistItemId']}/Move/0").status == 404
          and [r["Id"] for r in alice.get(f"/PlaylistToolkit/Playlists/{aid}/Items").json()["Items"]] == [r["Id"] for r in remaining_rows])

    # A user with edit permission (not the owner) uses the plugin's move and remove.
    alice.post(f"/PlaylistToolkit/Playlists/{aid}/Sharing", {"Shares": [{"UserId": dave.user_id, "CanEdit": True}, {"UserId": bob.user_id, "CanEdit": False}]})
    editor_rows = lambda: dave.get(f"/PlaylistToolkit/Playlists/{aid}/Items").json()["Items"]
    start_ids = [r["Id"] for r in editor_rows()]
    resp = dave.post(f"/PlaylistToolkit/Playlists/{aid}/Items/{editor_rows()[0]['PlaylistItemId']}/Move/{len(start_ids) - 1}")
    check("editor moves a track through the plugin", resp.status == 204 and [r["Id"] for r in editor_rows()] == start_ids[1:] + [start_ids[0]], f"status {resp.status}")
    resp = dave.delete(f"/PlaylistToolkit/Playlists/{aid}/Items", params={"entryIds": editor_rows()[0]["PlaylistItemId"]})
    check("editor removes a track through the plugin", resp.status == 204 and [r["Id"] for r in editor_rows()] == start_ids[2:] + [start_ids[0]], f"status {resp.status}")
    check("editor still cannot change image, description or sharing",
          dave.post(f"/PlaylistToolkit/Playlists/{aid}/Description", {"Overview": "x"}).status == 403
          and dave.post(f"/PlaylistToolkit/Playlists/{aid}/Sharing", {"Shares": []}).status == 403)

    # ---------------------------------------------------------------- image removal
    check("owner removes the image", alice.delete(f"/PlaylistToolkit/Playlists/{pid}/Image").status == 204)

    # ---------------------------------------------------------------- 5. duplicates
    album_song = next(i for i in small if i["Name"] == "Amber Song 11" and "Single" not in i["Path"])
    single_song = next(i for i in small if i["Name"] == "Amber Song 11" and "Single" in i["Path"])
    others = [i for i in small if i["Name"] != "Amber Song 11" and "Amber Fox Album 1" not in i["Path"]]
    first, second, fresh = others[0], others[1], others[2]
    dup_pid = create_playlist(alice, "T-Dup", [first["Id"], second["Id"]])
    alice.post(f"/Playlists/{dup_pid}/Items", params={"ids": album_song["Id"], "userId": alice.user_id})
    resp = alice.post(f"/PlaylistToolkit/Playlists/{dup_pid}/Duplicates", {"Ids": [first["Id"], single_song["Id"], fresh["Id"]]})
    result = resp.json()
    kinds = {d["Id"]: d["Kind"] for d in result["Duplicates"]}
    check("duplicate check: same item is 'exact', same song from another album is 'similar', new track is new",
          kinds == {first["Id"]: "exact", single_song["Id"]: "similar"} and result["NewIds"] == [fresh["Id"]] and result["Total"] == 3, str(result)[:300])
    album_id = alice.get(f"/Items/{album_song['Id']}", params={"UserId": alice.user_id}).json()["AlbumId"]
    result = alice.post(f"/PlaylistToolkit/Playlists/{dup_pid}/Duplicates", {"Ids": [album_id]}).json()
    check("duplicate check expands an album to its tracks", result["Total"] == 4 and len(result["Duplicates"]) >= 1 and len(result["NewIds"]) + len(result["Duplicates"]) == 4, str(result)[:200])
    resp = alice.post(f"/PlaylistToolkit/Playlists/{dup_pid}/Items", {"Ids": result["NewIds"]})
    count = alice.get(f"/PlaylistToolkit/Playlists/{dup_pid}/Items").json()["TotalRecordCount"]
    check("owner adds only the new tracks", resp.status == 200 and resp.json()["Added"] == len(result["NewIds"]) and count == 3 + len(result["NewIds"]), f"count={count}")
    alice.post(f"/PlaylistToolkit/Playlists/{dup_pid}/Sharing", {"Shares": [{"UserId": bob.user_id, "CanEdit": False}]})
    check("listen-only user can run the duplicate check but cannot add",
          bob.post(f"/PlaylistToolkit/Playlists/{dup_pid}/Duplicates", {"Ids": [fresh["Id"]]}).status == 200
          and bob.post(f"/PlaylistToolkit/Playlists/{dup_pid}/Items", {"Ids": [fresh["Id"]]}).status == 403)
    check("stock add with an empty id list is a no-op (used to cancel an add in the web client)",
          alice.post(f"/Playlists/{dup_pid}/Items", params={"ids": "", "userId": alice.user_id}).status == 204
          and alice.get(f"/PlaylistToolkit/Playlists/{dup_pid}/Items").json()["TotalRecordCount"] == count)

    # ---------------------------------------------------------------- 2. table rows, long playlist
    big_ids = [i["Id"] for i in bulk[:2500]]
    big_pid = create_playlist(alice, "T-Big", big_ids)
    wait_until(lambda: alice.get(f"/PlaylistToolkit/Playlists/{big_pid}/Items").json()["TotalRecordCount"] == 2500, timeout=60)
    alice.get(f"/PlaylistToolkit/Playlists/{big_pid}/Items")
    start = time.time()
    resp = alice.get(f"/PlaylistToolkit/Playlists/{big_pid}/Items")
    own_time = time.time() - start
    rows = resp.json()
    row = rows["Items"][0]
    check("track table rows for 2500 tracks", rows["TotalRecordCount"] == 2500 and [r["Id"] for r in rows["Items"]] == big_ids)
    check("row has title, artist, album, duration", row["Name"] and row["Artists"] and row["Album"] and row["RunTimeTicks"] and row["AlbumId"] and row["PlaylistItemId"], str(row))
    start = time.time()
    stock_rows = alice.get(f"/Playlists/{big_pid}/Items", params={"userId": alice.user_id, "Fields": "PrimaryImageAspectRatio,MediaSourceCount,Chapters,Trickplay"})
    stock_time = time.time() - start
    check("2500 rows load in under 1.5 s", own_time < 1.5, f"plugin {own_time:.2f} s / {len(resp.body) // 1024} KB, stock list request {stock_time:.2f} s / {len(stock_rows.body) // 1024} KB")
    check("rows are not readable without access", bob.get(f"/PlaylistToolkit/Playlists/{big_pid}/Items").status == 404)

    # ---------------------------------------------------------------- 4. smart shuffle
    artist_of = {r["Id"]: r["Artists"][0] for r in rows["Items"]}
    start = time.time()
    order = alice.get(f"/PlaylistToolkit/Playlists/{big_pid}/SmartShuffle").json()["ItemIds"]
    shuffle_time = time.time() - start
    check("smart shuffle returns every track once", sorted(order) == sorted(big_ids) and order != big_ids, f"{shuffle_time:.2f} s")
    repeats = sum(1 for a, b in zip(order, order[1:]) if artist_of[a] == artist_of[b])
    check("smart shuffle: no artist twice in a row (2500 tracks)", repeats == 0, f"repeats={repeats}")
    again = alice.get(f"/PlaylistToolkit/Playlists/{big_pid}/SmartShuffle").json()["ItemIds"]
    check("smart shuffle differs from call to call", again != order)
    seeded = [alice.get(f"/PlaylistToolkit/Playlists/{big_pid}/SmartShuffle", params={"seed": "5"}).json()["ItemIds"] for _ in range(2)]
    check("smart shuffle is reproducible with a seed", seeded[0] == seeded[1])

    # Songs the caller disliked (Jellyfin's own rating) are left out of the smart shuffle; other users are not affected.
    disliked_ids = order[:3]
    for track_id in disliked_ids:
        alice.post(f"/UserItems/{track_id}/Rating", params={"userId": alice.user_id, "likes": "false"})
    try:
        without = alice.get(f"/PlaylistToolkit/Playlists/{big_pid}/SmartShuffle").json()["ItemIds"]
        check("smart shuffle leaves out the caller's disliked songs", set(without).isdisjoint(disliked_ids) and len(without) == len(big_ids) - 3, f"{len(without)} ids")
    finally:
        for track_id in disliked_ids:
            alice.delete(f"/UserItems/{track_id}/Rating", params={"userId": alice.user_id})

    # Mark tracks as played: 40 just now, 10 a month ago, 30 by another user.
    played = order[:40]
    now = datetime.datetime.now(datetime.timezone.utc)
    for n, item_id in enumerate(played):
        stamp = (now - datetime.timedelta(minutes=n)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        assert alice.post(f"/UserPlayedItems/{item_id}", params={"userId": alice.user_id, "datePlayed": stamp}).status == 200
    old = order[100:110]
    for item_id in old:
        stamp = (now - datetime.timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        alice.post(f"/UserPlayedItems/{item_id}", params={"userId": alice.user_id, "datePlayed": stamp})
    for item_id in order[200:230]:
        bob.post(f"/UserPlayedItems/{item_id}", params={"userId": bob.user_id})

    # Expected result from the server's own play history (earlier test runs leave history behind).
    hours = admin.get(f"/Plugins/{PLUGIN_ID}/Configuration").json()["SmartShuffleRecentHours"]
    history = alice.get("/Items", params={"IncludeItemTypes": "Audio", "Recursive": "true", "UserId": alice.user_id,
                                          "IsPlayed": "true", "EnableUserData": "true", "Limit": "5000"}).json()["Items"]
    last_played = {i["Id"]: datetime.datetime.fromisoformat(i["UserData"]["LastPlayedDate"].replace("Z", "+00:00")[:19] + "+00:00")
                   for i in history if i["Id"] in artist_of and i["UserData"].get("LastPlayedDate")}
    recent = sorted((i for i, t in last_played.items() if t > now - datetime.timedelta(hours=hours)), key=last_played.get)
    older_half, newer_half = recent[:len(recent) - len(recent) // 2], recent[len(recent) - len(recent) // 2:]
    order2 = alice.get(f"/PlaylistToolkit/Playlists/{big_pid}/SmartShuffle").json()["ItemIds"]
    # The artist rule has priority, so a few not-recent tracks can end up between the recent ones.
    slack = 10
    check("smart shuffle: recently played tracks are at the end",
          set(played) <= set(recent) and set(recent) <= set(order2[-(len(recent) + slack):]), f"{len(recent)} recent of {len(order2)}")
    check("smart shuffle: the most recently played tracks come after the older recent ones",
          set(recent[-10:]) <= set(order2[-(len(newer_half) + slack):]))
    not_recent = (set(old) | set(order[200:230])) - set(recent)
    check("smart shuffle: tracks played long ago and other users' plays are not pushed back",
          len(not_recent & set(order2[-(len(recent) + slack):])) <= 3, f"{len(not_recent)} tracks")
    repeats2 = sum(1 for a, b in zip(order2, order2[1:]) if artist_of[a] == artist_of[b])
    check("smart shuffle: still no artist twice in a row with play history", repeats2 == 0, f"repeats={repeats2}")

    # Endless mode: a new order that follows a given track never opens with that track's artist.
    after_id = order2[-1]
    openers = set()
    for _ in range(12):
        again = alice.get(f"/PlaylistToolkit/Playlists/{big_pid}/SmartShuffle", params={"after": after_id}).json()["ItemIds"]
        openers.add(artist_of[again[0]])
        if len(again) != 2500 or artist_of[again[0]] == artist_of[after_id]:
            openers = None
            break
    check("endless mode: the reshuffled order is complete and never opens with the artist that just played", bool(openers), str(openers)[:120])

    # Endless mode: tracks still waiting in the queue must not open the next round.
    waiting = [i for i in big_ids if i not in last_played][:6]
    opened_with_waiting = 0
    for _ in range(8):
        plain = alice.get(f"/PlaylistToolkit/Playlists/{big_pid}/SmartShuffle", params={"after": waiting[-1]}).json()["ItemIds"]
        resp = alice.post(f"/PlaylistToolkit/Playlists/{big_pid}/SmartShuffle", {"After": waiting[-1], "Pending": waiting})
        told = resp.json()["ItemIds"]
        if resp.status != 200 or sorted(told) != sorted(big_ids) or set(waiting) & set(told[:-(len(waiting) + 10)]) or artist_of[told[0]] == artist_of[waiting[-1]]:
            opened_with_waiting = None
            break
        opened_with_waiting += len(set(waiting) & set(plain[:2000]))
    check("endless mode: tracks still waiting in the queue come last in the next round",
          opened_with_waiting is not None and opened_with_waiting > 0,
          f"without the hint {opened_with_waiting} of 48 waiting tracks were in the first 2000 positions")
    check("continuing a smart shuffle needs access to the playlist",
          bob.post(f"/PlaylistToolkit/Playlists/{big_pid}/SmartShuffle", {"After": waiting[-1], "Pending": waiting}).status == 404)

    one_artist = [i["Id"] for i in small if "Amber Fox" in i["Path"]][:5] + [i["Id"] for i in small if "Blue Heron" in i["Path"]][:5]
    mix_pid = create_playlist(alice, "T-TwoArtists", one_artist)
    for _ in range(10):
        mix = alice.get(f"/PlaylistToolkit/Playlists/{mix_pid}/SmartShuffle").json()["ItemIds"]
        names = ["A" if i in one_artist[:5] else "B" for i in mix]
        if any(a == b for a, b in zip(names, names[1:])):
            break
    else:
        names = None
    check("smart shuffle alternates strictly when two artists have equal shares", names is None, str(names))
    starts = set()
    for _ in range(10):
        mix = alice.get(f"/PlaylistToolkit/Playlists/{mix_pid}/SmartShuffle", params={"after": one_artist[0]}).json()["ItemIds"]
        starts.add("A" if mix[0] in one_artist[:5] else "B")
    check("endless mode with two artists: after artist A the new order always starts with B", starts == {"B"}, str(starts))
    tiny_waiting = one_artist[:2] + one_artist[5:7]
    positions = []
    for _ in range(10):
        mix = alice.post(f"/PlaylistToolkit/Playlists/{mix_pid}/SmartShuffle", {"After": tiny_waiting[-1], "Pending": tiny_waiting}).json()["ItemIds"]
        positions.append(min(mix.index(i) for i in tiny_waiting))
    check("endless mode on a 10-track playlist: the 4 waiting tracks are the last 4 of the next round", min(positions) >= 6, str(positions))

    # ---------------------------------------------------------------- playback command
    check("play without an open client connection is refused cleanly",
          alice.post("/PlaylistToolkit/Play", {"ItemIds": order[:5], "StartIndex": 0}).status == 409)
    player = jf.login("alice", device_id="pt-test-player")
    caps = player.post("/Sessions/Capabilities/Full", {"PlayableMediaTypes": ["Audio"], "SupportedCommands": ["Play"], "SupportsMediaControl": True})
    socket_path = "/socket?" + urllib.parse.urlencode({"ApiKey": player.token, "deviceId": player.device_id})
    ws = wsclient.WebSocket(jf.BASE, socket_path)
    try:
        time.sleep(1)
        max_queue = alice.get("/PlaylistToolkit/Config").json()["MaxQueueSize"]
        resp = player.post("/PlaylistToolkit/Play", {"ItemIds": order2, "StartIndex": 10})
        message = ws.wait_for("Play", timeout=15) if resp.status == 200 else {}
        data = message.get("Data", {})
        got = [g.replace("-", "") for g in data.get("ItemIds", [])]
        check("play command reaches the calling client over its own connection",
              resp.status == 200 and got == order2[10:10 + max_queue] and data.get("PlayCommand") == "PlayNow" and data.get("StartIndex") == 0,
              f"caps={caps.status} play={resp.status} {resp.text()[:120]} queued={len(got)}")
        check("play reports how many tracks were left out", resp.status == 200 and resp.json() == {"Queued": max_queue, "Truncated": 2500 - 10 - max_queue}, resp.text())
        resp = player.post("/PlaylistToolkit/Play", {"ItemIds": order2[:3], "Mode": "next"})
        message = ws.wait_for("Play", timeout=15) if resp.status == 200 else {}
        check("play next is sent as PlayNext", message.get("Data", {}).get("PlayCommand") == "PlayNext")
        check("the web client can resolve a full queue in one request (URL length)",
              player.get("/Items", params={"Ids": ",".join(order2[:max_queue]), "UserId": player.user_id, "Limit": "300",
                                           "Fields": "Chapters,MediaSources,Trickplay", "ExcludeLocationTypes": "Virtual",
                                           "EnableTotalRecordCount": "false", "CollapseBoxSetItems": "false"}).status == 200)
    finally:
        ws.close()

    # ---------------------------------------------------------------- 7. M3U
    resp = alice.get(f"/PlaylistToolkit/Playlists/{dup_pid}/Export")
    m3u = resp.text()
    dup_rows = alice.get(f"/PlaylistToolkit/Playlists/{dup_pid}/Items").json()["Items"]
    check("M3U export", resp.status == 200 and m3u.startswith("#EXTM3U") and m3u.count("#EXTINF:") == len(dup_rows)
          and "attachment" in resp.headers.get("Content-Disposition", ""), resp.headers.get("Content-Disposition", ""))
    check("M3U export needs access", carol.get(f"/PlaylistToolkit/Playlists/{dup_pid}/Export").status == 404)
    resp = bob.post("/PlaylistToolkit/Import", {"Name": "T-Imported", "Content": m3u})
    imported = resp.json() if resp.status == 200 else {}
    check("M3U import creates a playlist with the same tracks in the same order",
          resp.status == 200 and imported["Matched"] == len(dup_rows) and imported["Unmatched"] == []
          and [r["Id"] for r in bob.get(f"/PlaylistToolkit/Playlists/{imported['PlaylistId']}/Items").json()["Items"]] == [r["Id"] for r in dup_rows], resp.text()[:200])
    new_info = bob.get(f"/PlaylistToolkit/Playlists/{imported['PlaylistId']}").json() if imported else {}
    check("imported playlist is private and owned by the importing user",
          new_info.get("IsOwner") and not new_info.get("OpenAccess") and alice.get(f"/PlaylistToolkit/Playlists/{imported.get('PlaylistId')}").status == 404)
    foreign = "#EXTM3U\n#EXTINF:3,Blue Heron - Blue Song 12\nD:\\Music\\elsewhere\\whatever.mp3\n#EXTINF:100,Nobody - Missing Song\n/nowhere/missing.mp3\n" \
              + "C:\\other\\" + small[5]["Path"].rsplit("/", 1)[1] + "\n"
    resp = bob.post("/PlaylistToolkit/Import", {"Name": "T-Foreign", "Content": foreign})
    result = resp.json() if resp.status == 200 else {}
    check("M3U import matches by artist/title and by file name, reports the rest",
          result.get("Total") == 3 and result.get("Matched") == 2 and len(result.get("Unmatched", [])) == 1 and "Missing Song" in result["Unmatched"][0], resp.text()[:300])
    check("M3U import cannot append to a playlist without edit right",
          bob.post("/PlaylistToolkit/Import", {"PlaylistId": dup_pid, "Content": m3u}).status == 403)
    check("M3U import with nothing matching creates no playlist",
          bob.post("/PlaylistToolkit/Import", {"Name": "T-Nothing", "Content": "/nowhere/a.mp3\n"}).json()["PlaylistId"] == "00000000000000000000000000000000")
    check("M3U import without name is rejected", bob.post("/PlaylistToolkit/Import", {"Content": m3u}).status == 400)

    # ---------------------------------------------------------------- Instant Mix untouched
    mix_track = alice.get(f"/Items/{small[0]['Id']}/InstantMix", params={"UserId": alice.user_id, "Limit": "20"})
    mix_list = alice.get(f"/Playlists/{pid}/InstantMix", params={"UserId": alice.user_id, "Limit": "20"})
    check("stock Instant Mix endpoints still answer", mix_track.status == 200 and mix_list.status == 200, f"{mix_track.status}/{mix_list.status}")

    # ---------------------------------------------------------------- administrator on a visible playlist
    alice.post(f"/PlaylistToolkit/Playlists/{pid}/Sharing", {"OpenAccess": True})
    admin_info = admin.get(f"/PlaylistToolkit/Playlists/{pid}").json()
    check("administrator may manage, share and edit a public playlist of another user, but is not its owner",
          admin_info["CanManage"] and admin_info["CanShare"] and admin_info["CanEditItems"] and not admin_info["IsOwner"])
    check("public playlist: other normal user still cannot manage it",
          bob.post(f"/PlaylistToolkit/Playlists/{pid}/Description", {"Overview": "x"}).status == 403
          and bob.post(f"/PlaylistToolkit/Playlists/{pid}/Sharing", {"Shares": []}).status == 403
          and bob.post(f"/PlaylistToolkit/Playlists/{pid}/Items", {"Ids": [small[40]["Id"]]}).status == 403)

    artist_sorting(admin, alice)
    marks_during_playback(alice, small)
    membership(admin, alice, bob, small)
    automatic_playlists(admin, alice, bob, dave, settings, small, bulk)
    coexistence(admin, alice, anon, settings, small)
    delete_test_playlists([alice, bob, carol, dave, admin])
    failed = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(failed)} of {len(RESULTS)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
