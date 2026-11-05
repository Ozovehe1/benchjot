import matplotlib.pyplot as plt
import pandas as pd
import plotly.graph_objects as go
from sklearn.datasets import load_digits
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import ConfusionMatrixDisplay, accuracy_score, f1_score
from sklearn.model_selection import train_test_split

X, y = load_digits(return_X_y=True)
X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.25, stratify=y, random_state=0)
models = {
    "logreg": LogisticRegression(max_iter=2000),
    "forest": RandomForestClassifier(n_estimators=200, random_state=0),
}
rows, pred = [], {}
for name, m in models.items():
    pred[name] = m.fit(X_tr / 16, y_tr).predict(X_te / 16)
    rows.append({"model": name,
                 "accuracy": round(accuracy_score(y_te, pred[name]), 3),
                 "macro_f1": round(f1_score(y_te, pred[name], average="macro"), 3)})
    print(f"{name:7} acc {rows[-1]['accuracy']:.3f}")
display(pd.DataFrame(rows).set_index("model"))

ConfusionMatrixDisplay.from_predictions(y_te, pred["forest"], cmap="Greys", colorbar=False)
plt.title("forest: test confusion")
plt.show()

per_class = {n: f1_score(y_te, p, average=None).round(3) for n, p in pred.items()}
fig = go.Figure([go.Bar(x=list(range(10)), y=v, name=n) for n, v in per_class.items()])
fig.update_layout(title="F1 per digit", xaxis_title="digit", yaxis_title="F1", barmode="group")
fig.show()
