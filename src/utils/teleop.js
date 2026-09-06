/**
 * Teleop key -> twist mapping.
 *
 * Lives here rather than inside DashboardView so the /cmd_vel publisher and
 * the X/Y/Z readout under the D-pad share one definition -- they used to
 * derive the twist separately and disagree -- and so it can be tested without
 * pulling the whole view (and its asset imports) into the test run.
 */

// The twist the current key set commands. Both the /cmd_vel publisher and the
// X/Y/Z readout under the D-pad derive from this. They used to compute it
// separately, and the readout only knew about i / , / j / l -- so every
// diagonal (u o m .) and every holonomic key displayed 0.00 while the robot
// was plainly moving.
export function twistFromKeys(keys, speed, turnSpeed) {
  let lx = 0, ly = 0, az = 0, moving = false;

  // Non-Holonomic
  if (keys["u"]) { lx = speed; az = turnSpeed; moving = true; }
  if (keys["i"]) { lx = speed; az = 0; moving = true; }
  if (keys["o"]) { lx = speed; az = -turnSpeed; moving = true; }
  if (keys["j"]) { lx = 0; az = turnSpeed; moving = true; }
  if (keys["l"]) { lx = 0; az = -turnSpeed; moving = true; }
  if (keys["m"]) { lx = -speed; az = -turnSpeed; moving = true; }
  if (keys[","]) { lx = -speed; az = 0; moving = true; }
  if (keys["."]) { lx = -speed; az = turnSpeed; moving = true; }

  // Holonomic
  if (keys["U"]) { lx = speed; ly = speed; moving = true; }
  if (keys["I"]) { lx = speed; ly = 0; moving = true; }
  if (keys["O"]) { lx = speed; ly = -speed; moving = true; }
  if (keys["J"]) { lx = 0; ly = speed; moving = true; }
  if (keys["L"]) { lx = 0; ly = -speed; moving = true; }
  if (keys["M"]) { lx = -speed; ly = speed; moving = true; }
  if (keys["<"]) { lx = -speed; ly = 0; moving = true; }
  if (keys[">"]) { lx = -speed; ly = -speed; moving = true; }

  return { lx, ly, az, moving };
}
