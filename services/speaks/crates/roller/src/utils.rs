use counter::Counter;
use itertools::{Itertools, iproduct};
use std::{cmp::Ordering, collections::BinaryHeap, hash::Hash};

use crate::ast::{BinOpr, Display, Res};

pub fn cartesian_product_single(vector: Vec<isize>, n: usize) -> Vec<Vec<isize>> {
    (0..n).fold(vec![vec![]], |r: Vec<Vec<isize>>, _| {
        iproduct!(r.iter(), vector.iter())
            .map(|(v, x)| {
                let mut v1 = v.clone();
                v1.push(*x);
                v1
            })
            .collect()
    })
}

pub fn list_to_string(l: Vec<isize>) -> String {
    std::iter::Iterator::intersperse(l.into_iter().map(|x| x.to_string()), ",".into()).collect()
}

pub fn combine_two_possibilities(
    lhs: Vec<isize>,
    opr: &BinOpr,
    rhs: Vec<isize>,
) -> impl Iterator<Item = isize> + '_ {
    iproduct!(lhs, rhs).map(|(lhs, rhs)| opr.modify(lhs, rhs))
}

pub fn counter_to_iter<'a, T>(c: Counter<T>) -> impl Iterator<Item = T> + 'a
where
    T: 'a + Hash + Eq + Copy,
{
    c.into_iter().flat_map(|(t, count)| (0..count).map(move |_| t))
}

pub fn counter_to_prob(c: Counter<isize>) -> Vec<(isize, f64)> {
    let total: usize = c.total();
    c.into_iter()
        .map(|(val, count)| (val, (count as f64 / total as f64)))
        .sorted_by(|(l, _), (r, _)| Ord::cmp(l, r))
        .collect()
}

#[derive(Eq)]
struct MaxHeap((usize, isize));

impl Ord for MaxHeap {
    fn cmp(&self, MaxHeap((_, rhs)): &Self) -> Ordering {
        let MaxHeap((_, lhs)) = self;
        lhs.cmp(rhs)
    }
}

impl PartialOrd for MaxHeap {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl PartialEq for MaxHeap {
    fn eq(&self, MaxHeap((_, rhs)): &Self) -> bool {
        let MaxHeap((_, lhs)) = self;
        lhs == rhs
    }
}

#[derive(Eq)]
struct MinHeap((usize, isize));

impl Ord for MinHeap {
    fn cmp(&self, MinHeap((_, rhs)): &Self) -> Ordering {
        let MinHeap((_, lhs)) = self;
        rhs.cmp(lhs)
    }
}

impl PartialOrd for MinHeap {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl PartialEq for MinHeap {
    fn eq(&self, MinHeap((_, rhs)): &Self) -> bool {
        let MinHeap((_, lhs)) = self;
        lhs == rhs
    }
}

pub fn indices_of_k_greatest(vec: &[isize], k: usize) -> Vec<usize> {
    let mut p_queue = BinaryHeap::new();

    for (idx, v) in vec.iter().enumerate() {
        p_queue.push(MaxHeap((idx, *v)))
    }

    p_queue.into_iter_sorted().map(|MaxHeap((idx, _))| idx).take(k).collect()
}

pub fn indices_of_k_least(vec: &[isize], k: usize) -> Vec<usize> {
    let mut p_queue = BinaryHeap::new();

    for (idx, v) in vec.iter().enumerate() {
        p_queue.push(MinHeap((idx, *v)))
    }

    p_queue.into_iter_sorted().map(|MinHeap((idx, _))| idx).take(k).collect()
}

pub fn res_to_disp(r: Res) -> Option<Display> {
    match r {
        Res::Number(n) => Some(Display::Number(n)),
        Res::List(l) => Some(Display::List(l.into_iter().filter_map(res_to_disp).collect())),
        Res::Die(d) => Some(Display::Die(d)),
        Res::Unit | Res::Sigil(..) | Res::Func(..) | Res::Builtin(..) => None,
    }
}
