use anyhow::Result;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "residual", about = "NKP Residuality architecture CLI", version)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Subcommand)]
pub enum Command {
    Init,
    Add {
        #[command(subcommand)]
        target: AddTarget,
    },
    List {
        #[command(subcommand)]
        target: ListTarget,
    },
    Verify {
        #[command(subcommand)]
        check: VerifyCheck,
    },
    Matrix {
        #[command(subcommand)]
        op: MatrixOp,
    },
    SkillShow {
        name: String,
        #[arg(long)]
        version: bool,
    },
    SkillInstall {
        name: String,
        #[arg(long, default_value = "agnostic")]
        agent: String,
        #[arg(long)]
        global: bool,
    },
    SkillData {
        name: String,
    },
    SkillList,
    SkillCheck {
        name: String,
        #[arg(long, default_value = "agnostic")]
        agent: String,
    },
    Tag {
        #[command(subcommand)]
        op: TagOp,
    },
    Generate {
        #[command(subcommand)]
        artifact: GenerateArtifact,
    },
    Config,
}

#[derive(Subcommand)]
pub enum AddTarget {
    Stressor {
        #[arg(long)] description: String,
        #[arg(long)] attractor_id: String,
        #[arg(long)] naive_change: String,
        #[arg(long, default_value = "")] traits: String,
        #[arg(long, default_value = "")] components: String,
    },
    Purpose {
        #[arg(long)] description: String,
        #[arg(long)] attractor_id: String,
        #[arg(long)] feature: String,
        #[arg(long, default_value = "")] traits: String,
        #[arg(long, default_value = "")] components: String,
    },
    Attractor {
        #[arg(long)] name: String,
        #[arg(long)] valence: String,
        #[arg(long)] description: String,
        #[arg(long, default_value = "")] phase_state: String,
    },
    Term {
        #[arg(long)] term: String,
        #[arg(long)] definition: String,
        #[arg(long, default_value = "")] domain: String,
        #[arg(long, default_value = "")] related: String,
    },
    Persona {
        #[arg(long)] name: String,
        #[arg(long)] role: String,
        #[arg(long, default_value = "")] concerns: String,
        #[arg(long, default_value = "")] desires: String,
    },
    Iteration {
        #[arg(long, default_value = "")] notes: String,
        #[arg(long, default_value = "")] ri_score: String,
    },
}

#[derive(Subcommand)]
pub enum ListTarget {
    Stressors,
    Purposes,
    Attractors,
    Terminology,
    Personas,
    Iterations,
}

#[derive(Subcommand)]
pub enum VerifyCheck {
    Traits,
    Links,
    All,
}

#[derive(Subcommand)]
pub enum MatrixOp {
    Show,
    Calc,
    Criticality,
    Ri {
        #[arg(long)] stressors: usize,
        #[arg(long)] naive_survived: usize,
        #[arg(long)] residual_survived: usize,
    },
    Fusion,
    Fission,
}

#[derive(Subcommand)]
pub enum TagOp {
    Scan {
        #[arg(default_value = ".")] path: String,
    },
    Report {
        #[arg(default_value = ".")] path: String,
    },
}

#[derive(Subcommand)]
pub enum GenerateArtifact {
    Completions,
    Man,
    Hook,
}

pub fn run() -> Result<()> {
    let cli = Cli::parse();
    let cfg = crate::config::load()?;

    match cli.command {
        Command::Init => crate::storage::init(&cfg),
        Command::Add { target } => crate::storage::add(&cfg, target),
        Command::List { target } => crate::storage::list(&cfg, target),
        Command::Verify { check } => crate::verify::run(&cfg, check),
        Command::Matrix { op } => crate::nkp::run(&cfg, op),
        Command::SkillShow { name, version } => crate::skills::show(&name, version),
        Command::SkillInstall { name, agent, global } => crate::skills::install(&name, &agent, global),
        Command::SkillData { name } => crate::skills::data(&cfg, &name),
        Command::SkillList => crate::skills::list_all(),
        Command::SkillCheck { name, agent } => crate::skills::check(&name, &agent),
        Command::Tag { op } => crate::tags::run(&cfg, op),
        Command::Generate { artifact } => match artifact {
            GenerateArtifact::Completions => crate::skills::generate_completions(),
            GenerateArtifact::Man => crate::skills::generate_man(),
            GenerateArtifact::Hook => crate::skills::install_hook(),
        },
        Command::Config => crate::config::print(&cfg),
    }
}
