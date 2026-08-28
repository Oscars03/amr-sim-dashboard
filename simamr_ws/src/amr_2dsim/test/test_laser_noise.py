"""Verify the optional Gaussian range noise on /scan (laser_noise_stddev).

Defaults to 0 == "ideal scan", so an unconfigured robot is unaffected --
the first test pins that down. When enabled, only real hits are perturbed
(a max-range "no return" is left exact) and every value stays inside
[range_min, range_max].
"""
import numpy as np
import pytest
import rclpy

from amr_2dsim.simulator_node import AmrSimulator


@pytest.fixture
def node():
    rclpy.init()
    n = AmrSimulator()
    n.pose = {'x': 0.0, 'y': 0.0, 'theta': 0.0}
    n.laser_offset_x = n.laser_offset_y = n.laser_offset_yaw = 0.0
    n.laser_range_max = 12.0
    yield n
    n.destroy_node()
    rclpy.shutdown()


def set_walls(node, walls):
    node.wall_x3 = np.array([w[0][0] for w in walls], dtype=float)
    node.wall_y3 = np.array([w[0][1] for w in walls], dtype=float)
    node.wall_x4 = np.array([w[1][0] for w in walls], dtype=float)
    node.wall_y4 = np.array([w[1][1] for w in walls], dtype=float)


def scan_once(node):
    captured = []
    node.scan_pub.publish = captured.append
    node.stamp = node.get_clock().now().to_msg()
    node.publish_scan()
    return np.array(captured[-1].ranges)


# A closed 8x8 box centred on the origin: every ray hits something.
BOX = [((4, -4), (4, 4)), ((4, 4), (-4, 4)), ((-4, 4), (-4, -4)), ((-4, -4), (4, -4))]
# A single wall 3 m ahead (+x): rays toward +x hit, rays toward -x do not.
WALL_AHEAD = [((3.0, -10.0), (3.0, 10.0))]


def test_scan_is_ideal_by_default(node):
    assert node.laser_noise_stddev == 0.0
    set_walls(node, WALL_AHEAD)
    ranges = scan_once(node)
    assert ranges[0] == pytest.approx(3.0, abs=1e-9)      # ray straight ahead
    assert ranges[180] == pytest.approx(node.laser_range_max)  # nothing behind


def test_noise_perturbs_hits(node):
    set_walls(node, BOX)
    ideal = scan_once(node)

    node.laser_noise_stddev = 0.03
    np.random.seed(1)
    noisy = scan_once(node)

    assert not np.allclose(noisy, ideal)
    residuals = noisy - ideal
    # Every ray in the closed box is a hit, so all 360 are perturbed.
    assert np.count_nonzero(residuals) == 360
    assert residuals.std() == pytest.approx(0.03, rel=0.25)
    assert abs(residuals.mean()) < 0.01


def test_no_return_rays_are_left_exact(node):
    set_walls(node, WALL_AHEAD)
    node.laser_noise_stddev = 0.05
    np.random.seed(2)
    ranges = scan_once(node)

    # Rays that saw a wall are perturbed off the clean 3.0 m ...
    assert ranges[0] != pytest.approx(3.0, abs=1e-9)
    # ... but the ones that hit nothing stay pinned at range_max, not noised.
    behind = ranges[90:271]
    assert np.all(behind == node.laser_range_max)


def test_noise_never_escapes_range_bounds(node):
    set_walls(node, BOX)
    node.laser_noise_stddev = 5.0  # absurdly large on purpose
    np.random.seed(3)
    ranges = scan_once(node)

    assert ranges.min() >= 0.05           # scan.range_min
    assert ranges.max() <= node.laser_range_max
    assert np.all(np.isfinite(ranges))


def test_noise_is_unbiased_over_many_scans(node):
    set_walls(node, BOX)
    ideal = scan_once(node)  # laser_noise_stddev still 0 here

    node.laser_noise_stddev = 0.02
    np.random.seed(4)
    residuals = np.concatenate([scan_once(node) - ideal for _ in range(50)])

    assert abs(residuals.mean()) < 0.002
    assert residuals.std() == pytest.approx(0.02, rel=0.1)
