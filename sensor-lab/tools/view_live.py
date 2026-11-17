"""view_live.py — draw-only scope for sensor_read (sensor-lab).

House rule: this file may parse and plot, nothing else. No baseline math,
no envelope, no threshold — those are firmware stages and arrive as the
four fields defined in ../README.md:

    raw,corr,env,flex   (one line per 1 kHz sample, integers)

Spec (you write it — M1 onward):
  * usage: view_live.py [port], default /dev/ttyACM0
  * open with pyserial, skip lines until one starts with '#' (banner),
    then readline loop
  * rolling window ~5 s; 4 stacked subplots sharing the time axis:
      lane 1 raw   lane 2 corr   lane 3 env (0-1000)   lane 4 flex (step)
  * matplotlib: plt.pause(0.001) style redraw; Ctrl-C to exit cleanly
"""

# TODO(M1): imports, port arg, banner skip, readline loop, 4-lane plot.



