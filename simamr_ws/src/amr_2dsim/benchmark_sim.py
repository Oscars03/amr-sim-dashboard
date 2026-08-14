import time
import rclpy
from amr_2dsim.simulator_node import AmrSimulator

def main():
    rclpy.init()
    node = AmrSimulator()
    # Provide a fake map with 20 walls to make it a bit more realistic
    node.walls = [((i, i), (i+1, i+1)) for i in range(20)]
    node.wall_x3 = [w[0][0] for w in node.walls]
    node.wall_y3 = [w[0][1] for w in node.walls]
    node.wall_x4 = [w[1][0] for w in node.walls]
    node.wall_y4 = [w[1][1] for w in node.walls]
    import numpy as np
    node.wall_x3 = np.array(node.wall_x3)
    node.wall_y3 = np.array(node.wall_y3)
    node.wall_x4 = np.array(node.wall_x4)
    node.wall_y4 = np.array(node.wall_y4)
    
    print("Starting benchmark...")
    start_time = time.time()
    iterations = 100
    for _ in range(iterations):
        node.timer_callback()
    end_time = time.time()
    
    total_time = end_time - start_time
    print(f"Total time for {iterations} iterations: {total_time:.4f} seconds")
    print(f"Average time per iteration: {(total_time/iterations)*1000:.4f} ms")
    
    node.destroy_node()
    rclpy.shutdown()

if __name__ == '__main__':
    main()
