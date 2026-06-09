use crate::goodness::RollGoodness;
use crate::host::Host::{
    Custom, Els, GSR, KnifeThatTeaches, MasterOfCeremonies, RexPenopticum, Whiskers,
};
use rand::{
    Rng, SeedableRng,
    distributions::{Distribution, Standard},
    seq::SliceRandom,
};
use roller::Rollable;
use serenity::all::{
    Color, CreateActionRow, CreateAttachment, CreateEmbed, CreateEmbedFooter, ExecuteWebhook,
};
use serenity::{
    http::Http,
    model::{prelude::Message, webhook::Webhook},
};
use std::sync::Arc;

#[derive(Debug, Default)]
pub(crate) enum Thumbnail {
    #[default]
    Default,

    None,
    Url(String),
}

#[derive(Debug, Default)]
pub(crate) struct SendArgs {
    pub title: Option<String>,
    pub contents: Option<String>,
    pub img: Thumbnail,
    pub fields: Vec<(String, String)>,
    pub file: Option<String>,
    pub raw_file: Option<(Vec<u8>, String)>,
    pub components: Option<Vec<CreateActionRow>>,
    pub footer: Option<String>,
}

#[derive(Debug)]
pub(crate) enum Host {
    GSR,
    KnifeThatTeaches,
    RexPenopticum,
    Els,
    Whiskers,
    MasterOfCeremonies,
    Custom(String),
}

impl Host {
    pub(crate) fn get_host<S: Into<String>>(host: S) -> Host {
        let host = host.into();

        match host.as_str() {
            "gsr" => GSR,
            "knife" => KnifeThatTeaches,
            "rex" => RexPenopticum,
            "els" => Els,
            "whiskers" => Whiskers,
            "master" => MasterOfCeremonies,
            _ => Custom(host),
        }
    }

    pub(crate) fn name(&self) -> String {
        match self {
            GSR => "Gin Soaked Rag".to_owned(),
            KnifeThatTeaches => "Knife-That-Teaches".to_owned(),
            RexPenopticum => "Rex Panopticum".to_owned(),
            Els => "Stray-Thread Els".to_owned(),
            Whiskers => "Whiskers".to_owned(),
            MasterOfCeremonies => "Master of Ceremonies".to_owned(),
            Custom(name) => name.to_owned(),
        }
    }

    pub(crate) fn image(&self) -> String {
        (match self {
            GSR => "https://i.imgur.com/9z9IaYS.png",
            KnifeThatTeaches => "https://i.imgur.com/pkuxeAF.png",
            RexPenopticum => "https://i.imgur.com/sIxjMYW.png",
            Els => "https://i.imgur.com/wP8hBWb.png",
            Whiskers => "https://i.imgur.com/GMVzufH.png",
            MasterOfCeremonies => "https://i.imgur.com/Qp0EXST.png",
            Custom(_) => "",
        })
        .to_owned()
    }

    pub(crate) fn color(&self) -> Color {
        (match self {
            GSR => Color::new(0x276C4C),
            KnifeThatTeaches => Color::new(0x00674F),
            RexPenopticum => Color::new(0xCFBDDE),
            Els => Color::new(0xCFBDDE),
            Whiskers => Color::new(0x00674F),
            MasterOfCeremonies => Color::new(0x478085),
            Custom(_) => Color::new(0xCFBDDE),
        })
        .to_owned()
    }

    pub(crate) async fn send(
        &self,
        http: &Http,
        webhook: Arc<Webhook>,
        SendArgs { title, contents, img, fields, file, raw_file, components, footer }: SendArgs,
    ) -> Result<Option<Message>, serenity::Error> {
        let e = {
            let mut b = CreateEmbed::new();

            if let Some(title) = title {
                b = b.title(title);
            }

            if let Some(contents) = contents {
                b = b.description(contents);
            }

            b = b.color(self.color());

            match img {
                Thumbnail::None => (),
                Thumbnail::Default => b = b.thumbnail(self.image()),
                Thumbnail::Url(url) => b = b.thumbnail(url),
            }

            for (title, text) in fields {
                b = b.field(title, text, false);
            }

            if let Some(file) = file {
                b = b.image(file);
            }

            if let Some(footer) = footer {
                b = b.footer(CreateEmbedFooter::new(footer));
            }

            b
        };

        webhook
            .execute(http, components.is_some(), {
                let mut b = ExecuteWebhook::new();

                b = b.embeds(vec![e]);
                b = b.username(self.name());
                b = b.avatar_url(self.image());

                if let Some((data, filename)) = raw_file {
                    let attachment = CreateAttachment::bytes(data, filename);
                    b = b.add_file(attachment);
                }

                if let Some(components) = components {
                    b = b.components(components);
                }

                b
            })
            .await
    }

    pub(crate) async fn send_simple(
        &self,
        http: &Http,
        webhook: Arc<Webhook>,
        text: String,
    ) -> Result<Option<Message>, serenity::Error> {
        webhook
            .execute(http, false, {
                let mut b = ExecuteWebhook::new();

                b = b.username(self.name());
                b = b.content(text);

                let image = self.image();
                if image != "" {
                    b = b.avatar_url(self.image());
                }

                b
            })
            .await
    }
}

enum HostPicker {
    GSR,
    Panopticum,
    Els,
    Whiskers,
}

impl Distribution<HostPicker> for Standard {
    fn sample<R: Rng + ?Sized>(&self, _: &mut R) -> HostPicker {
        HostPicker::GSR
    }
}

pub(crate) fn host_says(_: &str, roll: &impl Rollable) -> (Host, String) {
    let mut rng = rand::rngs::StdRng::from_entropy();
    let goodness = roll.into();

    let (host, lines) = match rand::rngs::OsRng.sample(Standard) {
        HostPicker::GSR => (
            Host::GSR,
            match goodness {
                RollGoodness::Crit => vec![
                    "That? That was sublime. The _Host_ might actually take notice. Try not to squander this on something stupid.",
                    "You magnificent bastard, you actually pulled it off! Even the _Judge_ would rule in your favor on this one!",
                    "A rare and beautiful moment of competence. I’d say ‘remember this feeling,’ but let’s be honest -- you’ll never do it again.",
                    "A perfect roll? Either the _Watcher_ himself is guiding your hand or the Horizon just glitched in your favor.",
                    "Astonishing. Truly. If only you could bottle this and drink it before every battle -- oh wait, that’s just Tormerén wine.",
                    "You roll like a hero in a Brithwyn propaganda broadcast—unbelievably well and against all odds.",
                    "The _Host_ shines bright on you today! Or maybe it’s just the sun. Either way, take the win!",
                    "A perfect roll! Even the _Host_ might stop preening to take notice!",
                    "Now that is the kind of result that gets you canonized in a very biased Calarian history book.",
                    "An outcome so magnificent, even the _Watcher’s_ nebula might twinkle in appreciation.",
                    "You didn’t just roll well. You rolled so well that an Istrian caravan might name a strider after you.",
                    "The _Host’s_ aurora just flared slightly brighter in the sky. Probably unrelated, but I’m choosing to believe otherwise.",
                    "A success so flawless I half suspect you slipped into an alternate Faerrin where you’re actually competent.",
                    "If you keep rolling like this, someone’s going to start whispering about divine intervention. And not subtly.",
                ],
                RollGoodness::Good => vec![
                    "Hey! You did it! Kind of! In a roundabout, barely competent way, like a smuggler slipping past a Scale blockade!",
                    "Ah, there’s that spark of potential. I’d bottle it up and sell it in Tor's Strand if I thought you could do it again.",
                    "A surprising display of adequacy. Keep this up and you might just avoid being sacrificed to the Heir of the Plague.",
                    "Not bad! You’ve got more luck than an Istrian with a well-tuned Slide.",
                    "This could actually be worth writing about in the next Liturgy. Maybe. If I’m desperate for content.",
                    "Skill or luck? I’d bet luck, but the Compelled might say otherwise.",
                    "A performance worthy of at least one verse in a Lorandrin sea shanty. Maybe even two.",
                    "If this were Calaria, you’d get a commendation. If it were Brithwyn, you’d get a raise. If it were Velthara, you’d just get more work.",
                    "Ah, there’s that spark of potential. If you were a miner in Tor’s Strand, you’d call it a promising deposit.",
                    "Good! Not great, but good! A performance worthy of a junior clerk in the Iridescent Church, perhaps.",
                    "Your dice have made the _Host_ proud today. Not enough to grant divine favor, but just enough to avoid divine smiting.",
                    "This is the kind of success that gets turned into an over-embellished Tormerén painting. Take it and run.",
                ],
                RollGoodness::Okay => vec![
                    "Ah, a completely unremarkable roll. The kind the _Judge_ would rule ‘uninteresting’ and move on from.",
                    "Well, the good news is you didn’t make it onto the Midnight Sun casualty list. The bad news? You’re still not winning any medals.",
                    "The _Host_ smiles upon you. Not brightly, just... politely.",
                    "I’d inscribe this in the records of Hallia, but I think even the scribes would find it too dull to bother.",
                    "Hey, at least it’s better than rolling your way straight into the Stillness.",
                    "A solidly middle-of-the-road performance, like a Brithwyn merchant trying to undercut Fenrith.",
                    "You exist in a perfectly neutral state, like a diplomat from Rhædon who refuses to take sides. Admirable, but boring.",
                    "That was as middle-of-the-road as an Austrenite balancing their spiritual enlightenment with their ski lodge investment portfolio.",
                    "You roll like a Calarian bureaucrat—efficient, uninspired, and just barely competent enough to keep your job.",
                    "A result so unremarkable it will be neither recorded in Belvedere’s archives nor banned by the Pontifex. A rare feat.",
                    "Could be worse. Could be better. But if you’re praying to the _Watcher_, expect nothing more than a raised eyebrow.",
                ],
                RollGoodness::Bad => vec![
                    "Not your worst work, but let’s just say the _Host_ isn’t commissioning statues in your honor just yet.",
                    "You grazed success before tripping face-first into a pit in Istria.",
                    "A performance worthy of a Lorandrin pirate: flashy, messy, and ending with someone else taking your stuff.",
                    "I’ve seen Veltharan miners with better luck cracking a voidward deposit.",
                    "Mediocrity suits you. Comfortable, isn’t it? Like an old seerhorse you should’ve retired three campaigns ago.",
                    "You rolled like you were fighting a Fenrithi sea storm -- badly and with a sinking feeling.",
                    "Not quite a disaster, but definitely the kind of failure that gets archived in Belvedere for future scholars to laugh at.",
                    "That wasn’t even close. Did your dice slip into an adjacent Faerrin before landing?",
                    "If the _Compelled_ saw that, they’d demand you work twice as hard to make up for it. Maybe even three times.",
                    "At least you didn’t botch it so hard the _Host_ personally descended to revoke your citizenship.",
                    "Like a Fenrithi cargo ship running late—you’re off course, off balance, and barely scraping by.",
                ],
                RollGoodness::Fumble => vec![
                    "Oh, fantastic. I think even the _Judge_ winced at that one.",
                    "Did you offend the _Host_ recently? Because that was cursed.",
                    "If failure were a work of art, this would be auctioned off in Tormeré for an obscene amount.",
                    "You just fumbled hard enough to make the _Watcher_ look away in embarrassment.",
                    "I’d blame sabotage, but let’s be honest—you did this to yourself.",
                    "You roll like a Brithwyn noble negotiating with Calaria -- poorly and with devastating consequences.",
                    "I think even the _Stillness_ took pity on you there. That's saying something.",
                    "You just rolled like a Veltharan miner ignoring voidward safety protocols -- expect a cave-in on your hopes and dreams.",
                    "You just made a Brithwyn noble look competent. That’s how bad this shit is.",
                    "I’ve seen Lorandrin pirates with better luck escaping a blockade. Spoiler: they didn’t.",
                    "On a scale from ‘not great’ to ‘obliterated by an Outer God,’ you’re leaning dangerously close to the latter.",
                ],
            },
        ),
        HostPicker::Panopticum => (
            Host::RexPenopticum,
            match goodness {
                RollGoodness::Crit => vec![
                    "Exemplary. You are now a threat to chaos.",
                    "This is what balance aspires to be.",
                    "Perfection. Enjoy it. It’s on loan.",
                    "If you do that again, I may need to update your file. To include the word ‘competent.’",
                    "A statistical outlier. You’ll be studied. Dissected, if necessary.",
                    "All variables aligned. Either you are blessed… or supervised.",
                ],
                RollGoodness::Good => vec![
                    "A favorable result. Sustain it, and you might avoid further embarrassment.",
                    "Above threshold. Noted. Do not let it go to your head.",
                    "Commendable. Slightly.",
                    "Statistical windfall. Attribute it to preparation, not providence.",
                    "Order asserts itself. The _Judge_ approves.",
                    "An encouraging deviation. Maintain the trajectory.",
                    "Above expectation. Commendable. Temporarily.",
                    "Success achieved through effort or accident. I decline to guess.",
                    "A fine result. It will be noted. Briefly.",
                ],
                RollGoodness::Okay => vec![
                    "Acceptable. In the strictest, least enthusiastic sense of the word.",
                    "Mediocrity acknowledged. Proceed.",
                    "Neither justice nor injustice. Equilibrium.",
                    "Balance maintained. Momentum, questionable.",
                    "You’ve neither violated nor validated expectations.",
                    "A straight line through the noise. Useful. Barely.",
                    "This is the result we calibrate against. Do not mistake it for success.",
                ],
                RollGoodness::Bad => vec![
                    "Below the mean. Below the mode. Below my patience.",
                    "I have witnessed worse. But only barely.",
                    "A suboptimal manifestation. Note it. Improve.",
                    "Errors compound. This is one.",
                    "Insufficient for resolution. Sufficient for documentation.",
                    "A stumble. Let’s hope not habitual.",
                    "One more data point in a growing concern.",
                    "You tripped on the first stair. The staircase is long.",
                ],
                RollGoodness::Fumble => vec![
                    "Anomalous variance exceeds acceptable thresholds. Recommend recalibration of personal expectations.",
                    "Result logged. Performance review: abysmal. Remediation: unlikely.",
                    "This result constitutes a structural collapse in probability space. Avoid repeating.",
                    "Catastrophic misalignment detected. Please remain still while judgment recalibrates your worth.",
                    "Collapse observed. Dignity not found in the wreckage.",
                    "Your incompetence has become measurable. I am building a scale.",
                    "This result has been filed under 'incident.' Expect paperwork.",
                    "A reminder: entropy requires no help. And yet, you insist.",
                ],
            },
        ),
        HostPicker::Els => (
            Host::Els,
            match goodness {
                RollGoodness::Crit => vec![
                    "Now that’s a stitch so tight it hums. The kind they write chants about.",
                    "If I had half your luck, I’d still have both arms. Well done.",
                    "That’s the kind of magic we used to dream of. You earned this spark.",
                    "Even the dead gods would’ve clapped. Not bad for a sack of meat and nerves.",
                ],
                RollGoodness::Good => vec![
                    "Clean weave, solid stitch. You’ll live to botch another day.",
                    "Even _Vigil_ might’ve nodded at that one, before he vaporized.",
                    "You shine like a flare in the fog. Just try not to attract anything.",
                    "Tidy work. You'd make a half-decent Whisperer if the Weave wasn’t in tatters.",
                ],
                RollGoodness::Okay => vec![
                    "Thread’s thin, but it holds. You’ll pass. Barely.",
                    "That’s one way to survive. Not a good way. But a way.",
                    "Didn’t impress the gods, but didn’t wake anything hungry. Call it a win.",
                ],
                RollGoodness::Bad => vec![
                    "Almost stitched something useful… then pricked your thumb instead.",
                    "If that’s your best, I hope you brought friends. Or a shovel.",
                    "The Knot’s still holding. Shame your aim isn’t.",
                ],
                RollGoodness::Fumble => vec![
                    "Weave’s laughing at you. Don’t let it hear you cry.",
                    "Even Slumber would’ve winced at that one. And she’s dead.",
                    "Congratulations. You’ve made failure look like performance art.",
                ],
            },
        ),
        HostPicker::Whiskers => (
            Host::Whiskers,
            match goodness {
                RollGoodness::Crit => vec![
                    "By the _Host’s_ shimmering teeth, that’s it! That’s the roll that’ll crack The Zorbon’s grip on this rotten city.",
                    "Crit like that? Makes me think maybe we'll avoid it yet. Maybe the fungus hasn’t already hollowed us out.",
                    "That’s _Host_-touched, fungus-proof, spire-high. Enough to make even the Scale blink twice before weighin’ you.",
                ],
                RollGoodness::Good => vec![
                    "Ha! Now that’s a roll stout enough to shake spores off a beggar’s coat.",
                    "If you’d rolled that in the alleys of Hallia, folk would’ve bought you a drink. Or at least not thrown rocks.",
                    "Luck’s kissin’ your whiskers tonight, friend. Careful, though, sometimes it’s the _Judge_ leanin’ in, breath smellin’ of rope.",
                ],
                RollGoodness::Okay => vec![
                    "Could’ve been worse, could’ve been better. Story of my nine lives, really.",
                    "Middle o’ the road, eh? Careful -- roads here belong to Prime Meridian, and the potholes got teeth.",
                    "Didn’t impress the gods, but didn’t wake anything hungry. Call it a win.",
                ],
                RollGoodness::Bad => vec![
                    "Ha! That’s the kind of roll that makes the fuzz twitch their whiskers. They’re all spore-ridden, you know.",
                    "Not the worst thing I’ve seen in Hallia, but close. Reminds me of the time Sticks drank rainwater and found mushrooms growin’ in his ears.",
                    "Pfft. That roll’s weaker than Brithwyn ale on a church day. Makes me itch like mold in my fur.",
                ],
                RollGoodness::Fumble => vec![
                    "Ah, that’s how it starts -- the spores slip in through your teeth when you yawn. Careful now, it likes failures best.",
                    "A roll that bad? The Zorbon just wrote your obituary in mold across a sewer wall.",
                    "That’s a dice-tumble straight outta Sableclutch gutterball -- _Host_-forsaken luck. The Zorbon’ll be wearin’ your bones as marionette strings by dawn.",
                    "The _Host’s_ aurora don’t shine on that number. That’s fungus-shade, spores in your teeth, hyphae growin’ on your lungs",
                ],
            },
        ),
    };

    let line = lines.choose(&mut rng).unwrap().to_owned().to_owned();
    (host, line)
}
