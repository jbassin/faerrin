use color_eyre::Result;
use color_eyre::eyre::WrapErr;
use serde::Serialize;
use serde_json::{Value, json};
use std::sync::LazyLock;

// Chart-rendering service base URL — environment-driven (see .env.example), never
// hardcoded in source.
static CHART_BASE_URL: LazyLock<String> =
    LazyLock::new(|| std::env::var("CHART_BASE_URL").expect("CHART_BASE_URL must be set"));

#[derive(Serialize)]
pub struct Chart {
    #[serde(rename(serialize = "type"))]
    pub type_: String,
    pub options: Options,
    pub data: Data,
}

impl Chart {
    pub fn new<T: AsRef<str>>(title: T, data: Data) -> Self {
        Self { type_: "bar".to_string(), options: Options::new(title.as_ref().to_owned()), data }
    }

    pub fn json(&self) -> Result<String> {
        serde_json::to_string(&self).wrap_err("json serialization error")
    }

    pub fn url(&self) -> Result<String> {
        let c = serde_json::to_string(&self)?;
        let encoded = urlencoding::encode(&c);

        Ok(format!("{}/chart?w=1500&h=900&bkg=%23000000&c={encoded}", CHART_BASE_URL.as_str()))
    }
}

#[derive(Serialize)]
pub struct Options {
    pub title: Value,
    pub plugins: Value,
    pub scales: Value,
}

impl Options {
    pub fn new(title: String) -> Self {
        Self {
            title: json!({
                "display": true,
                "text": title,
            }),
            plugins: json!({
                "colorschemes": {
                    "scheme": "office.Atlas6"
                }
            }),
            scales: json!({
                "xAxes": [
                    {
                        "gridLines": {
                            "color": "#ff"
                        },
                        "scaleLabel": {
                            "display": true,
                            "labelString": "# rolled"
                        }
                    }
                ],
                "yAxes": [
                    {
                        "gridLines": {
                            "color": "#ff"
                        },
                        "ticks": {
                            "min": 0
                        },
                        "scaleLabel": {
                            "display": true,
                            "labelString": "% of rolls"
                        }
                    }
                ]
            }),
        }
    }
}

#[derive(Serialize)]
pub struct Data {
    #[serde(rename(serialize = "labels"))]
    pub y_axis: Vec<i32>,
    pub datasets: Vec<Dataset>,
}

#[derive(Serialize)]
pub struct Dataset {
    pub label: String,
    pub data: Vec<i32>,
}
