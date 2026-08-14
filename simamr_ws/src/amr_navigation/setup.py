import os
from glob import glob
from setuptools import find_packages, setup

package_name = 'amr_navigation'

setup(
    name=package_name,
    version='0.1.0',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages',
            ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        (os.path.join('share', package_name, 'launch'), glob(os.path.join('launch', '*launch.py'))),
        (os.path.join('share', package_name, 'config'), glob(os.path.join('config', '*.yaml'))),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='phutanate',
    maintainer_email='phutanate@todo.todo',
    description='SLAM mapping and Nav2 navigation bringup for the amr_2dsim Ackermann robot',
    license='Apache-2.0',
    extras_require={
        'test': [
            'pytest',
        ],
    },
    entry_points={
        'console_scripts': [
            'joy_ackermann_teleop = amr_navigation.joy_ackermann_teleop:main',
        ],
    },
)
