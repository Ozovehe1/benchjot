#!/usr/bin/env python3
"""Runs sample programs through public/workers/bj_capture.py and writes what it
captured into tests/fixtures/outputs/<case>/ (manifest.json and every chart spec).

These fixtures are the shared contract: the web's tests validate the manifests
against src/lib/run/outputs.ts, and the Android app copies them (its
scripts/web-fixtures.mjs) to test its chart renderer's spec -> model mapping.
CI reruns this with the pinned libraries in scripts/output-fixtures.txt and fails
if the committed fixtures differ.

  pip install -r scripts/output-fixtures.txt && python3 scripts/output-fixtures.py
"""
import json
import os
import shutil
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "public", "workers"))
import bj_capture  # noqa: E402

OUT = os.path.join(ROOT, "tests", "fixtures", "outputs")

DF = "import pandas as pd\ndf = pd.DataFrame({'epoch': [1, 2, 3, 4, 5], 'loss': [0.9, 0.6, 0.45, 0.4, 0.38], 'val': [1.0, 0.7, 0.55, 0.52, 0.53]})\n"
CASES = {
    # matplotlib and friends: one static figure each
    "matplotlib": "import matplotlib.pyplot as plt\nplt.plot([1, 2, 3], [3, 1, 2], label='a')\nplt.title('Training loss')\nplt.legend()\nplt.show()\n",
    "seaborn": DF + "import seaborn as sns\nsns.lineplot(data=df, x='epoch', y='loss')\n",
    "pandas-plot": DF + "df.plot(x='epoch')\n",
    "sklearn-confusion": "from sklearn.metrics import ConfusionMatrixDisplay\nConfusionMatrixDisplay.from_predictions([0, 1, 1, 0, 2, 2], [0, 1, 0, 0, 2, 1])\n",
    "pil": "from PIL import Image\nImage.new('RGB', (40, 20), (200, 30, 30))\n",
    "file": "from PIL import Image\nImage.new('RGB', (8, 8), (0, 0, 255)).save('written.png')\n",
    "table": DF + "df\n",
    # Plotly
    "plotly-scatter": "import plotly.graph_objects as go\nfig = go.Figure([go.Scatter(x=[1, 2, 3, 4], y=[10, 11, 12, 9], mode='lines+markers', name='train'), go.Scatter(x=[1, 2, 3, 4], y=[12, 12.5, 13, 12], mode='markers', name='val')])\nfig.update_layout(title='Loss', xaxis_title='epoch', yaxis_title='loss')\nfig.show()\n",
    "plotly-express": DF + "import plotly.express as px\npx.line(df, x='epoch', y=['loss', 'val'], title='Curves')\n",
    "plotly-bar": "import plotly.graph_objects as go\ngo.Figure([go.Bar(x=['a', 'b', 'c'], y=[3, 1, 2], name='count')])\n",
    "plotly-hbar": "import plotly.graph_objects as go\ngo.Figure([go.Bar(y=['a', 'b'], x=[2, 5], orientation='h')])\n",
    "plotly-histogram": "import plotly.graph_objects as go\ngo.Figure([go.Histogram(x=[1, 1, 2, 2, 2, 3, 4, 4, 5], nbinsx=5)])\n",
    "plotly-heatmap": "import plotly.express as px\npx.imshow([[5, 1, 0], [2, 7, 1], [0, 1, 9]], x=['cat', 'dog', 'owl'], y=['cat', 'dog', 'owl'], text_auto=True, title='Confusion matrix')\n",
    "plotly-box": "import plotly.graph_objects as go\ngo.Figure([go.Box(y=[1, 2, 2, 3, 4, 9], name='A'), go.Box(y=[2, 3, 3, 4, 5], name='B')])\n",
    "plotly-area": "import plotly.graph_objects as go\ngo.Figure([go.Scatter(x=[1, 2, 3], y=[1, 3, 2], fill='tozeroy', name='area')])\n",
    "plotly-pie": "import plotly.graph_objects as go\ngo.Figure([go.Pie(labels=['a', 'b', 'c'], values=[50, 30, 20])])\n",
    "plotly-numpy": "import numpy as np\nimport plotly.express as px\nx = np.linspace(0, 1, 5)\npx.scatter(x=x, y=x ** 2)\n",
    "plotly-unsupported": "import plotly.graph_objects as go\ngo.Figure([go.Scatter3d(x=[1, 2], y=[1, 2], z=[1, 2])])\n",
    # Altair / Vega-Lite
    "altair-line": DF + "import altair as alt\nalt.Chart(df).mark_line(point=True).encode(x='epoch:Q', y='loss:Q').properties(title='Loss')\n",
    "altair-scatter-color": DF + "import altair as alt\nlong = df.melt('epoch', var_name='split', value_name='value')\nalt.Chart(long).mark_point().encode(x='epoch', y='value', color='split').interactive()\n",
    "altair-bar": "import altair as alt, pandas as pd\nalt.Chart(pd.DataFrame({'k': ['a', 'b', 'c'], 'v': [3, 1, 2]})).mark_bar().encode(x='k:N', y='v:Q')\n",
    "altair-histogram": "import altair as alt, pandas as pd\nalt.Chart(pd.DataFrame({'x': [1, 1, 2, 2, 2, 3, 4, 4, 5]})).mark_bar().encode(alt.X('x:Q', bin=alt.Bin(maxbins=5)), y='count()')\n",
    "altair-heatmap": "import altair as alt, pandas as pd\nd = pd.DataFrame({'true': ['a', 'a', 'b', 'b'], 'pred': ['a', 'b', 'a', 'b'], 'n': [5, 1, 2, 7]})\nalt.Chart(d).mark_rect().encode(x='pred:N', y='true:N', color='n:Q')\n",
    "altair-area": DF + "import altair as alt\nalt.Chart(df).mark_area().encode(x='epoch', y='loss')\n",
    "altair-pie": "import altair as alt, pandas as pd\nalt.Chart(pd.DataFrame({'k': ['a', 'b'], 'v': [70, 30]})).mark_arc().encode(theta='v:Q', color='k:N')\n",
    "altair-boxplot": "import altair as alt, pandas as pd\nalt.Chart(pd.DataFrame({'g': ['a'] * 5 + ['b'] * 5, 'v': [1, 2, 3, 4, 9, 2, 3, 3, 4, 5]})).mark_boxplot().encode(x='g:N', y='v:Q')\n",
    # Bokeh
    "bokeh-line": "from bokeh.plotting import figure, show\np = figure(title='Loss', x_axis_label='epoch')\np.line([1, 2, 3, 4], [0.9, 0.6, 0.5, 0.45], legend_label='train', line_color='#1f77b4')\np.scatter([1, 2, 3, 4], [1.0, 0.7, 0.6, 0.58], legend_label='val', color='#ff7f0e')\nshow(p)\n",
    "bokeh-numpy": "import numpy as np\nfrom bokeh.plotting import figure, show\nx = np.arange(4, dtype=float)\np = figure()\np.line(x, x * 2)\nshow(p)\n",
    "bokeh-vbar": "from bokeh.plotting import figure, show\np = figure(x_range=['a', 'b', 'c'])\np.vbar(x=['a', 'b', 'c'], top=[3, 1, 2], width=0.8)\nshow(p)\n",
    "bokeh-histogram": "from bokeh.plotting import figure, show\np = figure()\np.quad(left=[0, 1, 2], right=[1, 2, 3], bottom=0, top=[2, 5, 1])\nshow(p)\n",
    "bokeh-heatmap": "from bokeh.plotting import figure, show\np = figure(x_range=['a', 'b'], y_range=['a', 'b'])\np.rect(x=['a', 'b', 'a', 'b'], y=['a', 'a', 'b', 'b'], width=1, height=1, fill_color=['#08306b', '#c6dbef', '#6baed6', '#08519c'])\nshow(p)\n",
    "bokeh-area": "from bokeh.plotting import figure, show\np = figure()\np.varea(x=[1, 2, 3], y1=[0, 0, 0], y2=[1, 3, 2])\nshow(p)\n",
    "bokeh-pie": "from math import pi\nfrom bokeh.plotting import figure, show\np = figure()\np.wedge(x=0, y=0, radius=1, start_angle=[0, pi], end_angle=[pi, 2 * pi], fill_color=['#1f77b4', '#ff7f0e'])\nshow(p)\n",
}


def main():
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT)
    for name, code in CASES.items():
        with tempfile.TemporaryDirectory() as work:
            cwd = os.getcwd()
            os.chdir(work)
            try:
                manifest = bj_capture.run_sync(code, os.path.join(work, ".out"))
            finally:
                os.chdir(cwd)
            assert manifest["items"], f"{name}: nothing captured"
            dest = os.path.join(OUT, name)
            os.makedirs(dest)
            for item in manifest["items"]:
                for fmt, file in item["files"].items():
                    if fmt == "json":
                        with open(os.path.join(work, ".out", file), encoding="utf-8") as f:
                            spec = json.load(f)
                        with open(os.path.join(dest, file), "w", encoding="utf-8") as f:
                            json.dump(spec, f, indent=1, sort_keys=True)
                            f.write("\n")
            for item in manifest["items"]:
                if item["kind"] == "image":  # pixel sizes of rendered text vary by platform; not part of the contract tests
                    item["width"] = item["height"] = 0
            with open(os.path.join(dest, "manifest.json"), "w", encoding="utf-8") as f:
                json.dump(manifest, f, indent=1, sort_keys=True)
                f.write("\n")
            kinds = ", ".join(f"{i['kind']}:{i.get('lib') or i.get('source')}" for i in manifest["items"])
            print(f"{name}: {kinds}")


if __name__ == "__main__":
    main()
