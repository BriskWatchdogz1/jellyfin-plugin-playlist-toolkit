#!/usr/bin/env python3
"""Prints the play queue of alice's browser session (used to verify browser tests)."""
import jf

alice = jf.login("alice")
for session in alice.get("/Sessions").json():
    if session.get("Client") == "Jellyfin Web" and session.get("UserName") == "alice":
        queue = [q["Id"] for q in session.get("NowPlayingQueue", [])]
        names = {}
        for start in range(0, len(queue), 100):
            chunk = queue[start:start + 100]
            for item in alice.get("/Items", params={"Ids": ",".join(chunk), "UserId": alice.user_id}).json()["Items"]:
                names[item["Id"]] = (item["Name"], (item.get("Artists") or ["?"])[0])
        ordered = [names.get(i, ("?", "?")) for i in queue]
        repeats = sum(1 for a, b in zip(ordered, ordered[1:]) if a[1] == b[1])
        now = session.get("NowPlayingItem", {}).get("Name")
        print(f"queue={len(queue)} now={now} artist-repeats={repeats}")
        print("first:", ordered[:6])
