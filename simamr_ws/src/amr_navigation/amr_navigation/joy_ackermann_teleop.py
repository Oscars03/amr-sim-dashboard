import rclpy
from rclpy.node import Node
from sensor_msgs.msg import Joy
from geometry_msgs.msg import Twist
from std_msgs.msg import Float64
from std_srvs.srv import Trigger

# Forza-style layout for a standard Xbox controller via the `joy` package's
# default axis/button order:
#   RT (right trigger) -> throttle (forward)
#   LT (left trigger)  -> brake / reverse
#   Left stick X        -> steering
#   Start/Menu button    -> reset pose (amr_2dsim's /reset_pose service)
#
# Axis/button indices and signs vary by controller/driver -- if yours
# doesn't match, run `ros2 topic echo /joy` while pressing each control and
# override the relevant parameter.


class JoyAckermannTeleop(Node):
    def __init__(self):
        super().__init__('joy_ackermann_teleop')

        self.declare_parameter('steer_axis', 0)
        self.declare_parameter('throttle_axis', 5)
        self.declare_parameter('brake_axis', 2)
        self.declare_parameter('reset_button', 7)
        self.declare_parameter('steer_axis_sign', 1.0)
        # Most Linux joystick drivers report trigger axes at +1.0 released,
        # -1.0 fully pressed.
        self.declare_parameter('trigger_idle_value', 1.0)
        self.declare_parameter('steer_deadzone', 0.05)
        self.declare_parameter('max_speed', 1.5)
        # Same top speed both ways -- reverse isn't a slower "parking" gear here.
        self.declare_parameter('max_reverse_speed', 1.5)
        self.declare_parameter('max_angular_vel', 1.5)

        self.steer_axis = self.get_parameter('steer_axis').value
        self.throttle_axis = self.get_parameter('throttle_axis').value
        self.brake_axis = self.get_parameter('brake_axis').value
        self.reset_button = self.get_parameter('reset_button').value
        self.steer_axis_sign = self.get_parameter('steer_axis_sign').value
        self.trigger_idle = self.get_parameter('trigger_idle_value').value
        self.steer_deadzone = self.get_parameter('steer_deadzone').value
        self.max_speed = self.get_parameter('max_speed').value
        self.max_reverse_speed = self.get_parameter('max_reverse_speed').value
        self.max_angular_vel = self.get_parameter('max_angular_vel').value

        self.cmd_pub = self.create_publisher(Twist, '/cmd_vel', 10)
        # Normalized steering fraction in [-1, 1] -- lets the sim track the
        # stick's steering angle directly at any speed, including standing
        # still (yaw-rate-only /cmd_vel can't express that: rate is
        # meaningless at zero speed). See simulator_node.py's ackermann branch.
        self.steering_cmd_pub = self.create_publisher(Float64, '/steering_cmd', 10)
        self.joy_sub = self.create_subscription(Joy, '/joy', self.on_joy, 10)
        self.reset_cli = self.create_client(Trigger, '/reset_pose')
        self._prev_reset_pressed = False

    def _axis(self, msg, index):
        return msg.axes[index] if 0 <= index < len(msg.axes) else 0.0

    def _button(self, msg, index):
        return bool(msg.buttons[index]) if 0 <= index < len(msg.buttons) else False

    def on_joy(self, msg):
        throttle = max(0.0, (self.trigger_idle - self._axis(msg, self.throttle_axis)) / 2.0)
        brake = max(0.0, (self.trigger_idle - self._axis(msg, self.brake_axis)) / 2.0)
        vx = throttle * self.max_speed - brake * self.max_reverse_speed

        steer = self._axis(msg, self.steer_axis) * self.steer_axis_sign
        if abs(steer) < self.steer_deadzone:
            steer = 0.0
        # No forward/reverse sign flip here: for the bicycle model, the
        # global-frame drift is y_global ~ vx^2 * tan(delta) -- vx^2 is
        # always >= 0, so the SAME physical wheel angle curves the car
        # toward the same side on screen whether driving forward or in
        # reverse (verified numerically). Flipping this by vx's sign (an
        # earlier attempt at this) actually made reverse curve the wrong way.
        steer_fraction = steer

        twist = Twist()
        twist.linear.x = vx
        twist.angular.z = steer_fraction * self.max_angular_vel
        self.cmd_pub.publish(twist)

        steering_msg = Float64()
        steering_msg.data = steer_fraction
        self.steering_cmd_pub.publish(steering_msg)

        pressed = self._button(msg, self.reset_button)
        if pressed and not self._prev_reset_pressed:
            if self.reset_cli.service_is_ready():
                self.reset_cli.call_async(Trigger.Request())
            else:
                self.get_logger().warn('reset_pose service not available yet')
        self._prev_reset_pressed = pressed


def main(args=None):
    rclpy.init(args=args)
    node = JoyAckermannTeleop()
    rclpy.spin(node)
    node.destroy_node()
    rclpy.shutdown()


if __name__ == '__main__':
    main()
