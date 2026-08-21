import rclpy
from rclpy.node import Node
from geometry_msgs.msg import Twist, TransformStamped
from sensor_msgs.msg import LaserScan, Imu, JointState
from std_msgs.msg import String, Bool, Float64
from std_srvs.srv import Trigger
from rcl_interfaces.msg import SetParametersResult
from tf2_ros import TransformBroadcaster
from nav_msgs.msg import Odometry
import math
import time
import json
import numpy as np
import xml.etree.ElementTree as ET
import logging

_DEFAULTS = {
    'kinematic_model': 'diff_drive',
    'wheel_base': 0.5,
    'robot_radius': 0.35,
    'laser_range_max': 12.0,
    'ticks_per_meter': 1000.0,
    'drive_axle_x': None,  # None = not declared in URDF (skip check)
    'max_steering_angle': math.radians(30.0),
    'geometry_type': 'circle',
}

def _get_float(elem, tag, default, warn_cb=None):
    """Parse a single float field from XML element; return default on any error."""
    child = elem.find(tag)
    if child is None or not (child.text or '').strip():
        return default
    try:
        return float(child.text.strip())
    except (ValueError, AttributeError) as e:
        if warn_cb:
            warn_cb(f"amr_sim_config: cannot parse <{tag}>: {e}, using default {default}")
        return default

def parse_sim_config(urdf_path: str) -> dict:
    """Parse <amr_sim_config> from URDF; returns dict with defaults for missing/invalid fields."""
    cfg = dict(_DEFAULTS)
    try:
        root = ET.parse(urdf_path).getroot()
        sim_cfg = root.find('amr_sim_config')
        if sim_cfg is None:
            return cfg
        # kinematic_model (string)
        km = sim_cfg.find('kinematic_model')
        if km is not None and (km.text or '').strip():
            cfg['kinematic_model'] = km.text.strip()
        # geometry_type (string)
        gt = sim_cfg.find('geometry_type')
        if gt is not None and (gt.text or '').strip():
            cfg['geometry_type'] = gt.text.strip()
        # numeric fields — each isolated so one bad value doesn't block others
        for field in ('wheel_base', 'robot_radius', 'laser_range_max', 'ticks_per_meter'):
            cfg[field] = _get_float(sim_cfg, field, cfg[field])
        # max_steering_angle is authored in DEGREES. Every other place that
        # touches this field already assumes degrees — the CreateRobotView
        # slider is labelled '°' and capped at 45, and DashboardView renders
        # `maxSteeringAngle * (Math.PI / 180)`. This parser used to read the
        # very same tag as radians, so one file meant 20° to the dashboard and
        # 20 rad to the simulator. Degrees wins; internally we stay in radians.
        msa = sim_cfg.find('max_steering_angle')
        if msa is not None and (msa.text or '').strip():
            try:
                deg = float(msa.text.strip())
            except ValueError as e:
                logging.warning(
                    f"amr_sim_config: cannot parse <max_steering_angle>: {e}, "
                    f"using default {math.degrees(cfg['max_steering_angle']):.1f} deg"
                )
            else:
                if 0.0 < deg < 1.6:
                    logging.warning(
                        f"amr_sim_config: <max_steering_angle>{deg}</max_steering_angle> "
                        f"is read as DEGREES ({deg} deg). A value this small looks like "
                        f"radians left over from the old convention — {deg} rad would be "
                        f"{math.degrees(deg):.1f} deg. Rewrite it in degrees if so."
                    )
                cfg['max_steering_angle'] = math.radians(deg)
        # drive_axle_x: optional; keep None if absent (means "skip convention check")
        ax_elem = sim_cfg.find('drive_axle_x')
        if ax_elem is not None and (ax_elem.text or '').strip():
            try:
                cfg['drive_axle_x'] = float(ax_elem.text.strip())
            except ValueError:
                pass
    except Exception as e:
        logging.warning(f"parse_sim_config: failed to read '{urdf_path}': {e}")
    return cfg


def parse_base_link_box(urdf_path: str):
    """Parse the base_link visual <box size="L W H"/> from URDF.

    Returns (length_x, width_y, offset_x, offset_y) or None if base_link has no
    box visual — the caller falls back to the circle footprint in that case.

    offset_x/offset_y are the box centre in the base_link frame, taken from the
    visual's <origin xyz="..."/>. They are frequently NOT zero and must not be
    dropped: an Ackermann robot whose base_link sits at the rear axle (the
    standard bicycle-model convention) carries its body well forward of the
    origin, so ignoring the origin silently shifts the entire collision
    footprint rearward by that offset — the footprint over-covers behind the
    robot and under-covers in front, which is exactly the direction that lets a
    front corner clip an obstacle the simulator reports as clear.

    Reuses the same box the dashboard already parses to draw the robot, so
    collision geometry matches what's rendered.
    """
    try:
        root = ET.parse(urdf_path).getroot()
        for link in root.findall('link'):
            if link.get('name') != 'base_link':
                continue
            visual = link.find('visual')
            if visual is None:
                return None
            box = visual.find('./geometry/box')
            if box is None or not box.get('size'):
                return None
            size = box.get('size').split()
            if len(size) < 2:
                return None
            offset_x = offset_y = 0.0
            origin = visual.find('origin')
            if origin is not None and origin.get('xyz'):
                xyz = origin.get('xyz').split()
                if len(xyz) >= 2:
                    try:
                        offset_x, offset_y = float(xyz[0]), float(xyz[1])
                    except ValueError:
                        logging.warning(
                            f"parse_base_link_box: cannot parse base_link visual "
                            f"origin xyz='{origin.get('xyz')}', assuming 0 0"
                        )
            return float(size[0]), float(size[1]), offset_x, offset_y
    except Exception as e:
        logging.warning(f"parse_base_link_box: failed to read '{urdf_path}': {e}")
    return None


def _check_drive_axle_convention(root: ET.Element, declared_axle_x, warn_cb, info_cb) -> None:
    """
    Verify that joints declared as drive wheels actually sit at declared_axle_x
    in the base_link frame.  Issues a WARNING (not an error) if they don't so
    that misconfigured robots are caught early without breaking the sim.

    Detection heuristic (covers standard ROS naming):
      - joint type="continuous" whose child link name contains 'wheel'
        AND (joint name or child name) contains 'front' OR 'drive'
      - Fallback: if <ros2_control> has <command_interface name="velocity">
        joints — those are the actuated wheels.
    ponytail: heuristic covers 95% of real robots; exotic naming needs explicit
              drive_axle_x tag. Upgrade: add a <drive_joints> tag to amr_sim_config.
    """
    if declared_axle_x is None:
        return  # user did not declare drive_axle_x → skip silently

    # Collect candidate drive joint names from ros2_control (most reliable)
    ros2_drive_joints = set()
    for rc in root.findall('ros2_control'):
        for joint in rc.findall('joint'):
            if joint.find('command_interface[@name="velocity"]') is not None:
                ros2_drive_joints.add(joint.get('name', ''))

    offenders = []
    for joint in root.findall('joint'):
        if joint.get('type') != 'continuous':
            continue
        jname = joint.get('name', '')
        child = joint.find('child')
        cname = child.get('link', '') if child is not None else ''

        # Is this a drive wheel? ros2_control list wins; fallback to name heuristic
        is_drive = (
            jname in ros2_drive_joints
            or (
                'wheel' in cname
                and ('front' in jname or 'drive' in jname or 'front' in cname)
            )
        )
        if not is_drive:
            continue

        origin = joint.find('origin')
        if origin is None or not origin.get('xyz'):
            continue
        xyz = origin.get('xyz').split()
        if len(xyz) < 1:
            continue
        actual_x = float(xyz[0])
        if abs(actual_x - declared_axle_x) > 1e-4:
            offenders.append((jname, actual_x))

    if offenders:
        for jname, ax in offenders:
            warn_cb(
                f"URDF convention violation: joint '{jname}' drive wheel is at "
                f"x={ax:.4f} in base_link frame, but <drive_axle_x> declares "
                f"x={declared_axle_x:.4f}.  ICC will be offset by "
                f"{ax - declared_axle_x:.4f} m — odometry will drift."
            )
    else:
        info_cb(
            f"Drive-axle convention OK: all drive wheels at x={declared_axle_x:.4f} "
            "(matches <drive_axle_x> declaration)."
        )

class AmrSimulator(Node):
    def __init__(self):
        super().__init__('amr_2sim')
        
        self.declare_parameter('map_file', '')
        self.declare_parameter('urdf_file', '')
        self.declare_parameter('initial_pose', [0.0, 0.0, 0.0])  # x, y, theta(rad)
        
        map_file_path = self.get_parameter('map_file').value
        urdf_file_path = self.get_parameter('urdf_file').value
        
        # Load kinematic config from URDF (or defaults if tag absent)
        self.laser_offset_x = 0.0
        self.laser_offset_y = 0.0
        self.laser_frame_id = 'laser_link'

        if urdf_file_path:
            cfg = parse_sim_config(urdf_file_path)
            self.kinematic_model = cfg['kinematic_model']
            self.wheel_base      = cfg['wheel_base']
            self.robot_radius    = cfg['robot_radius']
            self.laser_range_max = cfg['laser_range_max']
            self.ticks_per_meter = cfg['ticks_per_meter']
            self.max_steering_angle = cfg['max_steering_angle']
            self.geometry_type   = cfg['geometry_type']
            self.robot_length    = None
            self.robot_width     = None
            self.footprint_offset_x = 0.0
            self.footprint_offset_y = 0.0
            if self.geometry_type == 'rectangle':
                box = parse_base_link_box(urdf_file_path)
                if box is not None:
                    (self.robot_length, self.robot_width,
                     self.footprint_offset_x, self.footprint_offset_y) = box
                else:
                    self.get_logger().warning(
                        "geometry_type=rectangle but base_link has no <box size=.../> "
                        "visual — falling back to circle collision."
                    )
                    self.geometry_type = 'circle'
            self.get_logger().info(
                f"Loaded config from URDF: model={self.kinematic_model} "
                f"wheel_base={self.wheel_base} max_steer={math.degrees(self.max_steering_angle):.1f}° "
                f"geometry={self.geometry_type}"
                + (f" ({self.robot_length}x{self.robot_width}"
                   f" @ offset {self.footprint_offset_x:+.3f},{self.footprint_offset_y:+.3f})"
                   if self.geometry_type == 'rectangle' else '')
            )
            # laser joint offset + drive-axle convention check
            try:
                root = ET.parse(urdf_file_path).getroot()
                for joint in root.findall('joint'):
                    child = joint.find('child')
                    if child is not None:
                        link_name = child.get('link', '')
                        if 'laser' in link_name or 'lidar' in link_name:
                            self.laser_frame_id = link_name
                            origin = joint.find('origin')
                            if origin is not None and origin.get('xyz'):
                                xyz = origin.get('xyz').split()
                                if len(xyz) >= 2:
                                    self.laser_offset_x = float(xyz[0])
                                    self.laser_offset_y = float(xyz[1])
                            self.get_logger().info(
                                f"Loaded laser config: frame={self.laser_frame_id}, "
                                f"offset=({self.laser_offset_x}, {self.laser_offset_y})"
                            )
                            break
                _check_drive_axle_convention(
                    root,
                    cfg['drive_axle_x'],
                    self.get_logger().warning,
                    self.get_logger().info,
                )
            except Exception as e:
                self.get_logger().error(f"Failed to load laser joint from URDF: {e}")
        else:
            self.kinematic_model = _DEFAULTS['kinematic_model']
            self.wheel_base      = _DEFAULTS['wheel_base']
            self.robot_radius    = _DEFAULTS['robot_radius']
            self.laser_range_max = _DEFAULTS['laser_range_max']
            self.ticks_per_meter = _DEFAULTS['ticks_per_meter']
            self.max_steering_angle = _DEFAULTS['max_steering_angle']
            self.geometry_type   = _DEFAULTS['geometry_type']
            self.robot_length    = None
            self.robot_width     = None
            self.footprint_offset_x = 0.0
            self.footprint_offset_y = 0.0

        _ip = self.get_parameter('initial_pose').value
        self._initial_pose = (float(_ip[0]), float(_ip[1]), float(_ip[2]))
        self.pose = {'x': self._initial_pose[0],
                     'y': self._initial_pose[1],
                     'theta': self._initial_pose[2]}
        self.walls = []
        
        if map_file_path:
            try:
                with open(map_file_path, 'r') as f:
                    world_data = json.load(f)
                    for w in world_data.get('walls', []):
                        p1 = (float(w[0][0]), float(w[0][1]))
                        p2 = (float(w[1][0]), float(w[1][1]))
                        self.walls.append((p1, p2))
                self.get_logger().info(f"Loaded world map from: {map_file_path}")
            except Exception as e:
                self.get_logger().error(f"Failed to load map: {e}")
        
        if not self.walls:
            self.walls = [
                ((5.0, -5.0), (5.0, 5.0)),
                ((5.0, 5.0), (-5.0, 5.0)),
                ((-5.0, 5.0), (-5.0, -5.0)),
                ((-5.0, -5.0), (5.0, -5.0))
            ]

        # Convert walls to numpy arrays for vectorized raycasting
        self.wall_x3 = np.array([w[0][0] for w in self.walls])
        self.wall_y3 = np.array([w[0][1] for w in self.walls])
        self.wall_x4 = np.array([w[1][0] for w in self.walls])
        self.wall_y4 = np.array([w[1][1] for w in self.walls])
        # Pre-compute collision geometry (static walls — never changes)
        self._wall_dx = self.wall_x4 - self.wall_x3
        self._wall_dy = self.wall_y4 - self.wall_y3
        self._wall_len_sq = np.where(
            self._wall_dx**2 + self._wall_dy**2 > 0,
            self._wall_dx**2 + self._wall_dy**2,
            1.0  # avoid div/0 for degenerate walls
        )
        self._robot_radius_sq = 0.0  # set after robot_radius is loaded

        self.declare_parameter('enable_watchdog', False)
        self.declare_parameter('watchdog_timeout', 0.5)
        # Cache parameter values — updated via callback, not polled every tick
        self._watchdog_enabled = False
        self._watchdog_timeout = 0.5
        self.add_on_set_parameters_callback(self._on_params_changed)
        self._robot_radius_sq = self.robot_radius ** 2  # cache for vectorized collision
        if self.geometry_type == 'rectangle':
            self._half_length = self.robot_length / 2.0
            self._half_width = self.robot_width / 2.0
            # Box centre in the base_link frame (see parse_base_link_box).
            self._foot_ox = self.footprint_offset_x
            self._foot_oy = self.footprint_offset_y

        if self._is_collision(*self._initial_pose):
            self.get_logger().error(
                f"initial_pose {self._initial_pose} is inside a wall/obstacle — "
                "the robot will be unable to translate from this position. "
                "Check map_file and initial_pose for consistency."
            )

        self.cmd_vel = {'vx': 0.0, 'vy': 0.0, 'w': 0.0}
        self.last_cmd_time = time.time()
        self.last_time = time.time()

        # ----------------------------------------------------
        # 1. เพิ่มตัวแปรสำหรับเก็บค่า Encoder สะสม (Cumulative Pulses)
        # ----------------------------------------------------
        self.total_pulse_left = 0.0
        self.total_pulse_right = 0.0
        self._scan_intensities = [1.0] * 360  # pre-allocated, reused every tick

        self.tf_broadcaster = TransformBroadcaster(self)
        
        self.odom_pub = self.create_publisher(Odometry, '/odom', 10)
        self.scan_pub = self.create_publisher(LaserScan, '/scan', 10)
        self.encoder_pub = self.create_publisher(String, '/wheel/encoder', 10)
        self.sub_cmd = self.create_subscription(Twist, '/cmd_vel', self.cmd_callback, 10)
        # Optional explicit steering channel (e.g. a joystick's steering
        # wheel/stick): a normalized fraction in [-1, 1] of max_steering_angle.
        # /cmd_vel's angular.z alone can't represent "wheel turned while
        # parked" -- yaw rate is meaningless at vx=0, so the ackermann branch
        # falls back to it, but /steering_cmd lets the visual/physical
        # steering angle track the input directly at any speed, moving or not.
        self.steering_cmd_sub = self.create_subscription(Float64, '/steering_cmd', self.steering_cmd_callback, 10)
        self._explicit_steer_fraction = None
        self._last_steering_cmd_time = 0.0
        self._steering_cmd_timeout = 0.5
        
        self.wheel_vel_pub = self.create_publisher(Twist, '/wheel/vel', 10)
        self.imu_pub = self.create_publisher(Imu, '/imu/data', 10)
        self.joint_pub = self.create_publisher(JointState, '/joint_states', 10)
        self.current_steering_angle = 0.0

        self.effect_pub = self.create_publisher(Bool, '/effect_active', 10)
        self.collision_pub = self.create_publisher(Bool, '/collision', 10)
        self.actuate_srv = self.create_service(Trigger, '/actuate_effect', self.actuate_callback)
        self.reset_pose_srv = self.create_service(Trigger, '/reset_pose', self.reset_pose_callback)
        self.effect_timer = None

        self.timer = self.create_timer(0.05, self.timer_callback)
        
    def _on_params_changed(self, params):
        for p in params:
            if p.name == 'enable_watchdog':
                self._watchdog_enabled = bool(p.value)
            elif p.name == 'watchdog_timeout':
                self._watchdog_timeout = float(p.value)
        return SetParametersResult(successful=True)

    def actuate_callback(self, request, response):
        self.get_logger().info("Actuator effect triggered!")
        msg = Bool()
        msg.data = True
        self.effect_pub.publish(msg)
        if self.effect_timer is not None:
            self.effect_timer.cancel()
        self.effect_timer = self.create_timer(3.0, self.effect_timer_callback)
        response.success = True
        response.message = "Effect triggered"
        return response

    def reset_pose_callback(self, request, response):
        # Thorough reset of the robot state (like a fresh launch)
        self.pose = {'x': self._initial_pose[0], 'y': self._initial_pose[1],
                     'theta': self._initial_pose[2], 'vx': 0.0, 'vy': 0.0, 'w': 0.0}
        self.cmd_vel = {'vx': 0.0, 'vy': 0.0, 'w': 0.0}
        self.total_pulse_left = 0.0
        self.total_pulse_right = 0.0
        self.current_steering_angle = 0.0
        self.last_time = time.time()

        # Publish empty/initial states to clear old data
        msg = String()
        msg.data = f"0.0,0.0"
        self.encoder_pub.publish(msg)

        self.get_logger().info("Robot state completely reset to initial pose.")
        response.success = True
        response.message = "Simulation state reset successfully"
        return response

    def effect_timer_callback(self):
        msg = Bool()
        msg.data = False
        self.effect_pub.publish(msg)
        if self.effect_timer:
            self.effect_timer.cancel()
            self.effect_timer = None
        
    def cmd_callback(self, msg):
        self.last_cmd_time = time.time()
        self.cmd_vel['vx'] = msg.linear.x
        self.cmd_vel['vy'] = msg.linear.y
        self.cmd_vel['w'] = msg.angular.z

    def steering_cmd_callback(self, msg):
        self._explicit_steer_fraction = max(-1.0, min(1.0, msg.data))
        self._last_steering_cmd_time = time.time()

    def timer_callback(self):
        current_time = time.time()
        dt = current_time - self.last_time
        
        if dt <= 0:
            dt = 0.05
            
        self.last_time = current_time

        if self._watchdog_enabled and (current_time - self.last_cmd_time > self._watchdog_timeout):
            vx, vy, w = 0.0, 0.0, 0.0
        else:
            vx = self.cmd_vel['vx']
            vy = self.cmd_vel['vy']
            w = self.cmd_vel['w']

        # Determine robot velocities based on kinematic model
        if self.kinematic_model == 'diff_drive':
            vy = 0.0 # Diff drive cannot move sideways
        elif self.kinematic_model == 'ackermann':
            vy = 0.0 # Car cannot move sideways
            has_explicit_steer = (
                self._explicit_steer_fraction is not None
                and (current_time - self._last_steering_cmd_time) < self._steering_cmd_timeout
            )
            if has_explicit_steer:
                # Steering wheel/stick position drives the angle directly,
                # like a real car -- turning it while parked still moves the
                # front wheels, it just doesn't rotate the chassis until vx != 0.
                delta = self._explicit_steer_fraction * self.max_steering_angle
                delta = max(-self.max_steering_angle, min(self.max_steering_angle, delta))
                self.current_steering_angle = delta
                w = 0.0 if abs(vx) < 1e-4 else vx * math.tan(delta) / self.wheel_base
            elif abs(vx) < 1e-4:
                w = 0.0  # Ackermann cannot turn in place
                self.current_steering_angle = 0.0
            else:
                # Treat raw w command as intent, calculate required steering angle
                delta = math.atan((w * self.wheel_base) / vx)
                # Clamp to physical limits
                delta = max(-self.max_steering_angle, min(self.max_steering_angle, delta))
                self.current_steering_angle = delta
                # Derive achievable w
                w = vx * math.tan(delta) / self.wheel_base
        
        # Integrate Position (Global Frame) ด้วยสมการ Midpoint 
        mid_theta = self.pose['theta'] + (w * dt / 2.0)
        new_theta = self.pose['theta'] + (w * dt)
        
        # Rotate local vx, vy to global frame (ใช้มุมค่ากลางเพื่อความแม่นยำตอนเข้าโค้ง)
        v_global_x = vx * math.cos(mid_theta) - vy * math.sin(mid_theta)
        v_global_y = vx * math.sin(mid_theta) + vy * math.cos(mid_theta)

        new_x = self.pose['x'] + (v_global_x * dt)
        new_y = self.pose['y'] + (v_global_y * dt)

        # Orientation is resolved for this tick regardless of whether the
        # translation gets blocked below, so all collision candidates use
        # new_theta for the (rectangle) footprint check.
        if not self._is_collision(new_x, new_y, new_theta):
            self.pose['x'] = new_x
            self.pose['y'] = new_y
            collided = False
        else:
            # Try sliding along X or Y
            if not self._is_collision(new_x, self.pose['y'], new_theta):
                self.pose['x'] = new_x
                self.get_logger().warn("Collision! Sliding along X.", throttle_duration_sec=1.0)
                collided = True
            elif not self._is_collision(self.pose['x'], new_y, new_theta):
                self.pose['y'] = new_y
                self.get_logger().warn("Collision! Sliding along Y.", throttle_duration_sec=1.0)
                collided = True
            else:
                self.get_logger().warn("Collision Detected! Stopped translation.", throttle_duration_sec=1.0)
                collided = True

        self.pose['theta'] = new_theta

        # ----------------------------------------------------
        # Simulate Fake Encoder (approximated for all models to a differential equivalent for visualization)
        # ----------------------------------------------------
        v_right = vx + (w * self.wheel_base / 2.0)
        v_left = vx - (w * self.wheel_base / 2.0)
        
        # Calculate pulse increments
        delta_pulse_right = v_right * dt * self.ticks_per_meter
        delta_pulse_left = v_left * dt * self.ticks_per_meter
        
        # Accumulate pulses
        self.total_pulse_right += delta_pulse_right
        self.total_pulse_left += delta_pulse_left
        
        sim_v_right = delta_pulse_right / (self.ticks_per_meter * dt)
        sim_v_left = delta_pulse_left / (self.ticks_per_meter * dt)
        
        wheel_v = (sim_v_right + sim_v_left) / 2.0
        wheel_w = (sim_v_right - sim_v_left) / self.wheel_base

        self.stamp = self.get_clock().now().to_msg()

        self.publish_tf()
        self.publish_scan()
        self.publish_odom()
        self.publish_collision(collided)

        # 3. ส่งข้อมูล Topic ด้วยค่าสะสมที่แปลงเป็นจำนวนเต็ม (Integer)
        self.publish_encoder(int(self.total_pulse_left), int(self.total_pulse_right))
        self.publish_wheel_vel(wheel_v, wheel_w)
        self.publish_imu()
        self.publish_joint_states()

    def publish_collision(self, collided: bool):
        msg = Bool()
        msg.data = bool(collided)
        self.collision_pub.publish(msg)

    def publish_joint_states(self):
        js = JointState()
        js.header.stamp = self.stamp
        if self.kinematic_model == 'ackermann':
            js.name = ['virtual_wheel_fl', 'virtual_wheel_fr']
            js.position = [float(self.current_steering_angle), float(self.current_steering_angle)]
        self.joint_pub.publish(js)


    def publish_encoder(self, left_pulse, right_pulse):
        msg = String()
        msg.data = f"ENC:{left_pulse},{right_pulse}"
        self.encoder_pub.publish(msg)

    def publish_wheel_vel(self, v, w):
        msg = Twist()
        msg.linear.x = float(v)
        msg.angular.z = float(w)
        self.wheel_vel_pub.publish(msg)

    def publish_imu(self):
        msg = Imu()
        msg.header.stamp = self.stamp
        msg.header.frame_id = 'base_link'
        
        msg.orientation.z = math.sin(self.pose['theta'] / 2.0)
        msg.orientation.w = math.cos(self.pose['theta'] / 2.0)
        
        msg.angular_velocity.z = self.cmd_vel['w']
        
        msg.linear_acceleration.x = 0.0
        msg.linear_acceleration.y = 0.0
        msg.linear_acceleration.z = 9.81
        
        msg.orientation_covariance[0] = -1.0 
        msg.angular_velocity_covariance[0] = 0.0001
        msg.linear_acceleration_covariance[0] = 0.0001
        
        self.imu_pub.publish(msg)

    def publish_tf(self):
        t = TransformStamped()
        t.header.stamp = self.stamp
        t.header.frame_id = 'odom'
        t.child_frame_id = 'base_link'
        t.transform.translation.x = self.pose['x']
        t.transform.translation.y = self.pose['y']
        t.transform.translation.z = 0.0
        t.transform.rotation.z = math.sin(self.pose['theta'] / 2.0)
        t.transform.rotation.w = math.cos(self.pose['theta'] / 2.0)
        self.tf_broadcaster.sendTransform(t)

    def publish_scan(self):
        scan = LaserScan()
        scan.header.stamp = self.stamp
        scan.header.frame_id = self.laser_frame_id
        scan.angle_min = 0.0
        scan.angle_max = 2 * math.pi
        scan.angle_increment = math.radians(1.0) 
        scan.range_min = 0.05
        scan.range_max = self.laser_range_max
        scan.scan_time = 0.05
        scan.time_increment = 0.05 / 360.0
        
        # ponytail: dynamic laser offset based on URDF to fix map swinging
        lx = self.pose['x'] + self.laser_offset_x * math.cos(self.pose['theta']) - self.laser_offset_y * math.sin(self.pose['theta'])
        ly = self.pose['y'] + self.laser_offset_x * math.sin(self.pose['theta']) + self.laser_offset_y * math.cos(self.pose['theta'])

        # Fully vectorized: batch all 360 rays × all walls in one numpy op
        # angles shape: (360,)  walls shape: (N,)  result: (360, N)
        angles = self.pose['theta'] + np.arange(360, dtype=np.float64) * scan.angle_increment
        dx = scan.range_max * np.cos(angles)  # (360,)
        dy = scan.range_max * np.sin(angles)  # (360,)

        dwy = self.wall_y4 - self.wall_y3   # (N,)
        dwx = self.wall_x4 - self.wall_x3   # (N,)
        # den[i,j] = dx[i]*dwy[j] - dy[i]*dwx[j]
        den = dx[:, None] * dwy - dy[:, None] * dwx  # (360, N)

        wx3_lx = self.wall_x3 - lx  # (N,)
        wy3_ly = self.wall_y3 - ly  # (N,)

        t_all = np.where(
            np.abs(den) > 1e-9,
            (wx3_lx * dwy - wy3_ly * dwx) / np.where(np.abs(den) > 1e-9, den, 1.0),
            np.inf
        )  # (360, N)
        u_all = np.where(
            np.abs(den) > 1e-9,
            (wx3_lx * dy[:, None] - wy3_ly * dx[:, None]) / np.where(np.abs(den) > 1e-9, den, 1.0),
            np.inf
        )  # (360, N)

        hit = (t_all >= 0.0) & (t_all <= 1.0) & (u_all >= 0.0) & (u_all <= 1.0)
        t_all[~hit] = np.inf

        t_min = np.min(t_all, axis=1)  # (360,)
        distances = np.where(np.isinf(t_min), scan.range_max, t_min * scan.range_max)

        scan.ranges = distances.tolist()
        scan.intensities = self._scan_intensities
        self.scan_pub.publish(scan)

    def publish_odom(self):
        odom = Odometry()
        odom.header.stamp = self.stamp
        odom.header.frame_id = 'odom'
        odom.child_frame_id = 'base_link'
        
        odom.pose.pose.position.x = self.pose['x']
        odom.pose.pose.position.y = self.pose['y']
        odom.pose.pose.position.z = 0.0
        odom.pose.pose.orientation.z = math.sin(self.pose['theta'] / 2.0)
        odom.pose.pose.orientation.w = math.cos(self.pose['theta'] / 2.0)
        
        # 1. Pose Covariance (Global 'odom' frame)
        # ความคลาดเคลื่อนตำแหน่งโลก (Global) ต้องสะสมและเพิ่มขึ้นทั้งแกน X และ Y
        pose_cov = [0.0] * 36
        pose_cov[0]  = 0.01  # Global X
        pose_cov[7]  = 0.01  # Global Y (แก้ตรงนี้: ห้ามเป็น 1e-5 เด็ดขาด)
        pose_cov[14] = 1e-5  # Global Z
        pose_cov[21] = 1e-5  # Roll
        pose_cov[28] = 1e-5  # Pitch
        pose_cov[35] = 0.01  # Yaw
        odom.pose.covariance = pose_cov
        
        odom.twist.twist.linear.x = self.cmd_vel['vx']
        odom.twist.twist.linear.y = 0.0 if self.kinematic_model == 'diff_drive' else self.cmd_vel['vy']
        odom.twist.twist.angular.z = self.cmd_vel['w']
        
        # 2. Twist Covariance (Local 'base_link' frame)
        # ความเร็วในมุมมองหุ่น (Local) แบบ Diff-Drive ไม่ไถลข้าง แกน Y จึงเป็น 1e-5 ได้
        twist_cov = [0.0] * 36
        twist_cov[0]  = 0.01 if self.kinematic_model == 'diff_drive' else 0.001  # Local X (Forward)
        twist_cov[7]  = 1e-5 if self.kinematic_model == 'diff_drive' else 0.001  # Local Y (Lateral/Slip)
        twist_cov[14] = 1e-5 # Local Z
        twist_cov[21] = 1e-5 # Roll
        twist_cov[28] = 1e-5 # Pitch
        twist_cov[35] = 0.01 # Yaw
        odom.twist.covariance = twist_cov
        
        self.odom_pub.publish(odom)

    def check_collision(self, new_x, new_y):
        # Vectorized point-to-segment distance for all walls at once
        px = new_x - self.wall_x3  # (N,)
        py = new_y - self.wall_y3  # (N,)
        t = np.clip((px * self._wall_dx + py * self._wall_dy) / self._wall_len_sq, 0.0, 1.0)
        dist_sq = (new_x - self.wall_x3 - t * self._wall_dx) ** 2 + \
                  (new_y - self.wall_y3 - t * self._wall_dy) ** 2
        return bool(np.any(dist_sq < self._robot_radius_sq))

    def _is_collision(self, x, y, theta):
        """Dispatch to the footprint check matching geometry_type."""
        if self.geometry_type == 'rectangle':
            return self.check_collision_rect(x, y, theta)
        return self.check_collision(x, y)

    def check_collision_rect(self, x, y, theta):
        """Oriented rectangular footprint vs. wall segments.

        Transforms every wall segment into the robot's local frame (rotate
        by -theta, translate by -x,-y) and runs a vectorized slab
        (Liang-Barsky) segment-vs-AABB test against
        [ox - half_length, ox + half_length] x [oy - half_width, oy + half_width],
        where (ox, oy) is the footprint box's centre in the base_link frame.
        The offset is applied by shifting the local wall coordinates, which
        keeps the box axis-aligned and the slab test untouched. Returns True
        if any wall segment intersects the box.
        """
        c = math.cos(-theta)
        s = math.sin(-theta)
        x3 = self.wall_x3 - x
        y3 = self.wall_y3 - y
        x4 = self.wall_x4 - x
        y4 = self.wall_y4 - y
        lx3 = x3 * c - y3 * s - self._foot_ox
        ly3 = x3 * s + y3 * c - self._foot_oy
        lx4 = x4 * c - y4 * s - self._foot_ox
        ly4 = x4 * s + y4 * c - self._foot_oy

        dx = lx4 - lx3
        dy = ly4 - ly3

        hl, hw = self._half_length, self._half_width

        # Liang-Barsky clip params for the 4 box boundaries: left, right,
        # bottom, top (in the box's own axis-aligned local frame).
        p = np.stack([-dx, dx, -dy, dy])                        # (4, N)
        q = np.stack([lx3 + hl, hl - lx3, ly3 + hw, hw - ly3])  # (4, N)

        t0 = np.zeros_like(dx)
        t1 = np.ones_like(dx)
        reject = np.zeros_like(dx, dtype=bool)

        for i in range(4):
            pi, qi = p[i], q[i]
            parallel = np.abs(pi) < 1e-12
            reject |= parallel & (qi < 0.0)
            r = np.where(parallel, 0.0, qi / np.where(parallel, 1.0, pi))
            t0 = np.where((~parallel) & (pi < 0.0), np.maximum(t0, r), t0)
            t1 = np.where((~parallel) & (pi > 0.0), np.minimum(t1, r), t1)

        hit = (~reject) & (t0 <= t1)
        return bool(np.any(hit))

def main(args=None):
    rclpy.init(args=args)
    node = AmrSimulator()
    rclpy.spin(node)
    node.destroy_node()
    rclpy.shutdown()

if __name__ == '__main__':
    main()