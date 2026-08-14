import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():
    amr_2dsim_dir = get_package_share_directory('amr_2dsim')
    amr_nav_dir = get_package_share_directory('amr_navigation')
    amr_explorer_dir = get_package_share_directory('amr_explorer')

    default_urdf = os.path.join(amr_2dsim_dir, 'urdf', 'amr.urdf')
    default_world = os.path.join(amr_2dsim_dir, 'worlds', 'office.json')
    default_slam_params = os.path.join(amr_nav_dir, 'config', 'slam_params.yaml')
    default_explorer_params = os.path.join(amr_explorer_dir, 'config', 'explorer_params.yaml')

    urdf_file = LaunchConfiguration('urdf_file')
    world_file = LaunchConfiguration('world_file')
    initial_pose = LaunchConfiguration('initial_pose')
    slam_params_file = LaunchConfiguration('slam_params_file')
    explorer_params_file = LaunchConfiguration('explorer_params_file')
    use_rviz = LaunchConfiguration('use_rviz')

    sim_node = Node(
        package='amr_2dsim',
        executable='amr_sim_node',
        name='amr_2sim',
        output='screen',
        parameters=[{
            'urdf_file': urdf_file,
            'map_file': world_file,
            'initial_pose': initial_pose,
        }],
    )

    # amr_2dsim only broadcasts odom->base_link. Nothing publishes the
    # laser_joint transform from the URDF, so slam_toolbox drops every scan
    # without this. Values match laser_joint in amr.urdf.
    static_tf = Node(
        package='tf2_ros',
        executable='static_transform_publisher',
        name='laser_static_tf',
        output='screen',
        arguments=['--x', '0.2', '--y', '0', '--z', '0.25',
                   '--frame-id', 'base_link', '--child-frame-id', 'laser_link'],
    )

    slam = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            os.path.join(amr_nav_dir, 'launch', 'slam_launch.py')
        ),
        launch_arguments={
            'slam_params_file': slam_params_file,
            'use_rviz': use_rviz,
            'use_joy': 'false',
        }.items(),
    )

    explorer = Node(
        package='amr_explorer',
        executable='obstacle_avoidance',
        name='obstacle_avoidance',
        output='screen',
        parameters=[explorer_params_file],
    )

    return LaunchDescription([
        DeclareLaunchArgument('urdf_file', default_value=default_urdf),
        DeclareLaunchArgument('world_file', default_value=default_world),
        DeclareLaunchArgument('initial_pose', default_value='[-6.0, 4.0, -1.57]'),
        DeclareLaunchArgument('slam_params_file', default_value=default_slam_params),
        DeclareLaunchArgument('explorer_params_file', default_value=default_explorer_params),
        DeclareLaunchArgument('use_rviz', default_value='false',
                               description='Launch rviz2 with the mapping view'),
        sim_node,
        static_tf,
        slam,
        explorer,
    ])
