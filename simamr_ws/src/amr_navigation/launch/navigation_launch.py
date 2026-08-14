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
    nav2_bringup_dir = get_package_share_directory('nav2_bringup')

    default_map = os.path.join(amr_2dsim_dir, 'maps', 'map_1782965660.yaml')
    default_nav2_params = os.path.join(amr_nav_dir, 'config', 'nav2_params.yaml')
    default_rviz = os.path.join(amr_2dsim_dir, 'rviz', 'nav2_default.rviz')

    map_file = LaunchConfiguration('map')
    nav2_params_file = LaunchConfiguration('nav2_params_file')
    use_rviz = LaunchConfiguration('use_rviz')

    # NOTE: does not launch amr_2dsim itself -- start the sim separately
    # (e.g. via the dashboard, or `ros2 launch amr_2dsim sim_bringup.launch.py`)
    # before running this. Launching it here as well caused two amr_sim_node
    # instances to fight over /cmd_vel and /odom.
    localization = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            os.path.join(nav2_bringup_dir, 'launch', 'localization_launch.py')
        ),
        launch_arguments={
            'map': map_file,
            'params_file': nav2_params_file,
            'use_sim_time': 'false',
        }.items(),
    )

    navigation = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            os.path.join(nav2_bringup_dir, 'launch', 'navigation_launch.py')
        ),
        launch_arguments={
            'params_file': nav2_params_file,
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

    return LaunchDescription([
        DeclareLaunchArgument(
            'map', default_value=default_map,
            description='Full path to the saved map yaml file to navigate on',
        ),
        DeclareLaunchArgument(
            'nav2_params_file', default_value=default_nav2_params,
            description='Full path to the Nav2 params file',
        ),
        DeclareLaunchArgument(
            'use_rviz', default_value='true',
            description='Whether to launch rviz2 with the navigation view',
        ),
        localization,
        navigation,
        rviz,
    ])
