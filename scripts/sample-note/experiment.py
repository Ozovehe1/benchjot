import matplotlib.pyplot as plt, pandas as pd, plotly.graph_objects as go
from sklearn.datasets import load_digits
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import ConfusionMatrixDisplay, accuracy_score, f1_score
from sklearn.model_selection import train_test_split

X, y = load_digits(return_X_y=True)
X_tr, X_te, y_tr, y_te = train_test_split(X / 16, y, test_size=0.25, stratify=y, random_state=0)
models = {"logreg": LogisticRegression(max_iter=2000), "forest": RandomForestClassifier(200, random_state=0)}
pred = {n: m.fit(X_tr, y_tr).predict(X_te) for n, m in models.items()}
scores = {n: {"accuracy": accuracy_score(y_te, p), "macro_f1": f1_score(y_te, p, average="macro")} for n, p in pred.items()}
for n, s in scores.items():
    print(f"{n:7} acc {s['accuracy']:.3f}")

display(pd.DataFrame(scores).T.rename_axis("model").round(3))
ConfusionMatrixDisplay.from_predictions(y_te, pred["forest"], cmap="Greys", colorbar=False)
plt.title("forest: test confusion")
plt.show()
fig = go.Figure([go.Bar(x=list(range(10)), y=f1_score(y_te, p, average=None).round(3), name=n) for n, p in pred.items()])
fig.update_layout(title="F1 per digit", xaxis_title="digit", yaxis_title="F1", barmode="group")
fig.show()
