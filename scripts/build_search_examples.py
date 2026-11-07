#!/usr/bin/env python3
"""Precompute the "Does this idea already exist?" examples from real `invectus check` runs.

    invectus check -p <project> -c papers -k 6 --json "<query>" > q1.json   (one file per query)
    python3 -I scripts/build_search_examples.py map.json assets/search-examples.js q1.json q2.json ...

`map.json` is the same `invectus regions map` export used by build_map_data.py; it gives each
hit its index in the hero map's point list. Keeps titles, years, roles and scores only.
"""
import json
import sys


def main(map_path, out_path, *queries):
    order = {p["item_id"]: i for i, p in enumerate(json.load(open(map_path))["points"])}
    examples = []
    for path in queries:
        d = json.load(open(path))
        hits, seen = [], set()
        for h in d["search"]["hits"]:
            item = h["item"]
            iid = item.get("parent_id") or item["item_id"]
            if iid in seen or iid not in order:
                continue
            seen.add(iid)
            hits.append({"point": order[iid], "similarity": round(h["similarity"], 3),
                         "title": item.get("title") or "", "year": (item.get("date") or "")[:4],
                         "role": item.get("role", "neutral")})
        examples.append({
            "query": d["search"]["query"], "verdict": d["verdict"], "p_exists": round(d["p_exists"], 2),
            "summary": d["summary"], "next_step": d["next_step"], "position": d["position"],
            "calibration": d["calibration"]["quality"], "compared": d["search"]["vectors_compared"],
            "hits": hits[:5],
        })
    with open(out_path, "w") as f:
        f.write("window.INVECTUS_SEARCH=")
        json.dump(examples, f, separators=(",", ":"), ensure_ascii=False)
        f.write(";\n")


if __name__ == "__main__":
    main(*sys.argv[1:])
