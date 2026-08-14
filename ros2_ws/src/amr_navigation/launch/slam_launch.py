import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription
from launch.conditions import IfCondition
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():
    amr_2dsim_dir = get_package_share_directory('amr_2dsim')
    amr_nav_dir = get_package_share_directory('amr_navigation')

    default_slam_params = os.path.join(amr_nav_dir, 'config', 'slam_params.yaml')
    default_rviz = os.path.join(amr_2dsim_dir, 'rviz', 'mapping.rviz')

    slam_params_file = LaunchConfiguration('slam_params_file')
    use_rviz = LaunchConfiguration('use_rviz')
    use_joy = LaunchConfiguration('use_joy')
    joy_device_id = LaunchConfiguration('joy_device_id')
    joy_device_name = LaunchConfiguration('joy_device_name')

    # NOTE: does not launch amr_2dsim itself -- start the sim separately
    # (e.g. via the dashboard, or `ros2 launch amr_2dsim sim_bringup.launch.py`)
    # before running this. Launching it here as well caused two amr_sim_node
    # instances to fight over /cmd_vel and /odom.
    slam = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            os.path.join(
                get_package_share_directory('nav2_bringup'), 'launch', 'slam_launch.py'
            )
        ),
        launch_arguments={
            'params_file': slam_params_file,
            # amr_2dsim runs on the wall clock, not /clock.
            'use_sim_time': 'false',
        }.items(),
    )

    rviz = Node(
        package='rviz2',
        executable='rviz2',
        name='rviz2',
        arguments=['-d', default_rviz],
        output='screen',
        condition=IfCondition(use_rviz),
    )

    # Forza-style gamepad teleop for driving the robot around while mapping:
    # RT = throttle, LT = brake/reverse, left stick X = steering.
    # device_name selects by device name (e.g. "HyperX Clutch") so the right
    # controller is picked even if other joystick-like HID devices are
    # plugged in (macro pads etc. can also enumerate as joysticks) -- leave
    # it empty to fall back to device_id-based selection.
    # respawn=False so a missing/unplugged controller doesn't spam-retry.
    joy_driver = Node(
        package='joy',
        executable='joy_node',
        name='joy_node',
        parameters=[{'device_id': joy_device_id, 'device_name': joy_device_name}],
        output='screen',
        respawn=False,
        condition=IfCondition(use_joy),
    )
    joy_teleop = Node(
        package='amr_navigation',
        executable='joy_ackermann_teleop',
        name='joy_ackermann_teleop',
        output='screen',
        condition=IfCondition(use_joy),
    )

    return LaunchDescription([
        DeclareLaunchArgument(
            'slam_params_file', default_value=default_slam_params,
            description='Full path to the slam_toolbox params file',
        ),
        DeclareLaunchArgument(
            'use_rviz', default_value='true',
            description='Whether to launch rviz2 with the mapping view',
        ),
        DeclareLaunchArgument(
            'use_joy', default_value='false',
            description='Whether to launch the gamepad (Forza-style) teleop for driving while mapping',
        ),
        DeclareLaunchArgument(
            'joy_device_id', default_value='0',
            description='Joystick device index, used only if joy_device_name is empty',
        ),
        DeclareLaunchArgument(
            'joy_device_name', default_value='HyperX Clutch',
            description='Select the gamepad by name (see `cat /proc/bus/input/devices`); empty string falls back to joy_device_id',
        ),
        slam,
        rviz,
        joy_driver,
        joy_teleop,
    ])
