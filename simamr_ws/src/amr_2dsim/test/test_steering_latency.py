"""The steering transport delay (DelayLine) holds the demand back by `latency`.

No ROS needed -- amr_2dsim.actuators has no rclpy import:

    cd simamr_ws/src/amr_2dsim && python3 -m pytest test/test_steering_latency.py

Rhino (master-ackerman-thesis paper_nav2_params/data/sim_real_legA_postrefit_2026-10-20.md
section 13.1): the servo follows the commanded angle 0.050-0.055 s after the servo model, so
0.05 s = one 50 ms simulator tick.
"""
import pytest

from amr_2dsim.actuators import DelayLine


def feed(values, latency, dt=0.05, jitter=(0.0,)):
    d = DelayLine()
    out = []
    for k, v in enumerate(values):
        t = 1000.0 + k * dt + jitter[k % len(jitter)]
        out.append(d.update(t, v, latency))
    return out


def test_zero_latency_passes_through():
    assert feed([1.0, 2.0, 3.0], 0.0) == [1.0, 2.0, 3.0]


def test_one_tick_latency_is_one_tick_despite_clock_jitter():
    vals = [float(k) for k in range(20)]
    out = feed(vals, 0.05, jitter=(0.0, 0.0004, -0.0003, 0.0008, -0.0007))
    assert out[0] == 0.0                       # nothing old enough yet: initial
    assert out[1:] == vals[:-1]


def test_two_tick_latency():
    vals = [float(k) for k in range(10)]
    out = feed(vals, 0.1)
    assert out[:2] == [0.0, 0.0]
    assert out[2:] == vals[:-2]


def test_finer_ticks_hold_the_value_given_latency_ago():
    vals = [float(k) for k in range(100)]
    out = feed(vals, 0.05, dt=0.005)           # 5 ms ticks: 10 ticks of delay
    assert out[10:] == pytest.approx(vals[:-10])
