use crate::db::DB;
use color_eyre::Result;
use std::collections::HashMap;
use std::sync::mpsc::{Receiver, Sender};
use std::sync::{Arc, Mutex};

struct SyncMessage {
    base: usize,
    interval: String,
}

pub(crate) struct SyncDie {
    tx: Sender<SyncMessage>,
    rx: Receiver<Result<HashMap<String, Vec<i32>>>>,
}

impl SyncDie {
    pub(crate) async fn new(db: Arc<DB>) -> Arc<Mutex<Self>> {
        let (req_tx, req_rx) = std::sync::mpsc::channel::<SyncMessage>();
        let (res_tx, res_rx) = std::sync::mpsc::channel::<Result<HashMap<String, Vec<i32>>>>();

        tokio::spawn(async move {
            loop {
                let SyncMessage { base, interval } = req_rx.recv().unwrap();
                let res = db.get_dice(base, &interval).await;
                res_tx.send(res).unwrap();
            }
        });

        Arc::new(Mutex::new(SyncDie { tx: req_tx, rx: res_rx }))
    }

    pub(crate) fn get_dice(
        &mut self,
        base: usize,
        interval: String,
    ) -> Result<HashMap<String, Vec<i32>>> {
        self.tx.send(SyncMessage { base, interval })?;
        self.rx.recv()?
    }
}
