#!/usr/bin/env python3
"""Wait for one message on each of the given topics. Exit 0 only if all arrive.

Why this exists instead of `ros2 topic echo --once`:

  * echo --no-daemon is a cold node that gives discovery about a second and then
    exits 1 with "does not appear to be published yet" -- a publisher running at
    40 Hz reads as silent. Three of six CI jobs failed that way on v0.4.2, each
    on a different topic, with nothing wrong with the artifact.
  * echo *with* the daemon does wait, but the daemon caches a graph that
    outlives the run it came from, and it wedges: seen locally with every
    `ros2 topic list` hitting its timeout while --no-daemon answered in a second.

Neither setting is right in both places, so stop asking the CLI. One node, one
discovery, subscribed to every topic at once, waiting properly -- and it matches
each publisher's QoS, which echo's default RELIABLE/VOLATILE does not do for
BEST_EFFORT sensor streams like /scan.

  topic_probe.py --timeout 30 /odom /scan
"""
import argparse
import sys
import time

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile
from rosidl_runtime_py.utilities import get_message


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--timeout", type=float, default=30.0)
    ap.add_argument("topics", nargs="+")
    args = ap.parse_args()

    rclpy.init(args=None)
    node = Node("amr_smoke_probe")
    seen: set[str] = set()
    subs: dict[str, object] = {}
    deadline = time.monotonic() + args.timeout

    def subscribe(topic: str) -> None:
        # Copy the publisher's QoS. A RELIABLE subscriber never matches a
        # BEST_EFFORT publisher, and silence from a mismatch is indistinguishable
        # from silence from a dead sim.
        infos = node.get_publishers_info_by_topic(topic)
        if not infos:
            return
        info = infos[0]
        qos = QoSProfile(
            depth=1,
            reliability=info.qos_profile.reliability,
            durability=info.qos_profile.durability,
        )
        subs[topic] = node.create_subscription(
            get_message(info.topic_type),
            topic,
            lambda _msg, t=topic: seen.add(t),
            qos,
        )

    while time.monotonic() < deadline and len(seen) < len(args.topics):
        for topic in args.topics:
            if topic not in subs:
                subscribe(topic)
        rclpy.spin_once(node, timeout_sec=0.2)

    for topic in args.topics:
        print(("OK " if topic in seen else "MISS ") + topic)

    node.destroy_node()
    rclpy.shutdown()
    return 0 if len(seen) == len(args.topics) else 1


if __name__ == "__main__":
    sys.exit(main())
