# launch/sim_bringup.launch.py
import os
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import (
    SetEnvironmentVariable,
    DeclareLaunchArgument,
    OpaqueFunction,
)
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node
from launch.actions import ExecuteProcess


def generate_launch_description():
    pkg_name  = 'amr_2dsim'
    pkg_share = get_package_share_directory(pkg_name)

    default_urdf  = os.path.join(pkg_share, 'urdf',   'amr.urdf')
    default_world = os.path.join(pkg_share, 'worlds', 'room.json')

    declare_urdf = DeclareLaunchArgument(
        'urdf_file',
        default_value=default_urdf,
        description='Full path to robot URDF file',
    )
    declare_world = DeclareLaunchArgument(
        'world_file',
        default_value=default_world,
        description='Full path to world JSON file',
    )

    urdf_file  = LaunchConfiguration('urdf_file')
    world_file = LaunchConfiguration('world_file')

    def create_nodes(context):
        urdf_path  = context.perform_substitution(urdf_file)
        world_path = context.perform_substitution(world_file)

        print(f'\n{"="*55}')
        print(f'  🤖 Robot : {os.path.basename(urdf_path)}')
        print(f'  🌍 World : {os.path.basename(world_path)}')
        print(f'{"="*55}\n')

        with open(urdf_path, 'r') as f:
            robot_desc = f.read()

        # ── ROS nodes ONLY ───────────────────────────────────────────────────
        rsp_node = Node(
            package    = 'robot_state_publisher',
            executable = 'robot_state_publisher',
            name       = 'robot_state_publisher',
            parameters = [{'robot_description': robot_desc}],
            output     = 'screen',
        )

        sim_node = Node(
            package    = pkg_name,
            executable = 'amr_sim_node',
            name       = 'amr_simulator',
            output     = 'screen',
            parameters = [{'map_file': world_path, 'urdf_file': urdf_path}],
        )

        rosbridge = Node(
            package    = 'rosbridge_server',
            executable = 'rosbridge_websocket',
            name       = 'rosbridge_websocket',
            output     = 'screen',
        )

        # ── NO map-server here ───────────────────────────────────────────────
        return [rsp_node, sim_node, rosbridge]

    set_map_env  = SetEnvironmentVariable(
        name='AMR_MAP_FILE', value=world_file)
    set_urdf_env = SetEnvironmentVariable(
        name='AMR_URDF_FILE', value=urdf_file)

    return LaunchDescription([
        declare_urdf,
        declare_world,
        set_map_env,
        set_urdf_env,
        OpaqueFunction(function=create_nodes),
    ])