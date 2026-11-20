// Files written next to a server run's code for R, MATLAB (GNU Octave) and Julia cells, so their
// figures come back like Python's: bj_capture.py --collect gathers the images a run wrote, and
// these make each language write them without the user saving anything. The R and Octave files
// were run for real (Ubuntu 24.04's R 4.3 and Octave 8.4, 2026-11-18); the Julia one was not.

/** R: plots go to figure-N.png instead of Rplots.pdf (Rscript reads .Rprofile from the working directory). */
export const R_PROFILE = `options(device = function(...) grDevices::png(filename = "figure-%d.png", width = 1200, height = 900, res = 150))
`;

/**
 * Octave: runs main.m headless (gnuplot toolkit, figures hidden), prints an error with its line in
 * main.m, then saves every open figure as figure-N.png. Only the toolkit's own warning is silenced.
 */
export const OCTAVE_RUNNER = `% Benchjot: runs main.m on GNU Octave, then saves every open figure as figure-N.png.
bj_w = warning();
warning("off", "all");
graphics_toolkit("gnuplot");
warning(bj_w);
set(0, "defaultfigurevisible", "off");
bj_status = 0;
try
  run("main.m");
catch bj_err
  fprintf(stderr, "error: %s\\n", bj_err.message);
  for bj_i = 1:numel(bj_err.stack)
    if strcmp(bj_err.stack(bj_i).name, "main") && bj_err.stack(bj_i).line > 0
      fprintf(stderr, "error: called from main.m:%d\\n", bj_err.stack(bj_i).line);
    end
  end
  bj_status = 1;
end
bj_figs = sort(findall(0, "type", "figure"));
for bj_i = 1:numel(bj_figs)
  try
    print(bj_figs(bj_i), sprintf("figure-%d.png", bj_i), "-dpng", "-r150");
  catch
  end
end
exit(bj_status);
`;

/** Julia: runs main.jl; if it used Plots.jl and saved no image itself, saves the current plot. */
export const JULIA_RUNNER = `# Benchjot: runs main.jl, then saves the current Plots.jl plot if the code saved no image itself.
try
    include("main.jl")
finally
    try
        if isdefined(Main, :Plots) && !any(f -> endswith(f, ".png") || endswith(f, ".svg"), readdir())
            Base.invokelatest(Main.Plots.savefig, Base.invokelatest(Main.Plots.current), "figure-1.png")
        end
    catch
    end
end
`;
