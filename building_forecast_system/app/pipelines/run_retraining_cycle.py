from datetime import datetime
import traceback

from app.pipelines.fetch_all_circuits import run as fetch_all_circuits
from app.pipelines.harmonize_all_circuits import run as harmonize_all_circuits
from app.pipelines.train_all_short_term import run as train_all_short_term
from app.pipelines.train_all_long_term import run as train_all_long_term

from app.pipelines.fetch_weather import run as fetch_weather
from app.pipelines.harmonize_weather import run as harmonize_weather
from app.pipelines.build_global_series import run as build_global_series
from app.pipelines.train_global_short_term import run as train_global_short_term
from app.pipelines.train_global_long_term import run as train_global_long_term
from app.utils.run_tracking import finish_pipeline_run, start_pipeline_run


def run():
    run_id = start_pipeline_run("run_retraining_cycle")
    start_time = datetime.now()
    print("=" * 60)
    print(f"Starting retraining cycle at {start_time}")
    print("=" * 60)

    try:
        print("\n[1/9] Fetching latest circuit data...")
        fetch_all_circuits()

        print("\n[2/9] Harmonizing all circuit data...")
        harmonize_all_circuits()

        print("\n[3/9] Fetching latest weather data...")
        fetch_weather()

        print("\n[4/9] Harmonizing weather data...")
        harmonize_weather()

        print("\n[5/9] Building global aggregated series...")
        build_global_series()

        print("\n[6/9] Training all short-term circuit models...")
        train_all_short_term()

        print("\n[7/9] Training all long-term circuit models...")
        train_all_long_term()

        print("\n[8/9] Training global short-term model...")
        train_global_short_term()

        print("\n[9/9] Training global long-term model...")
        train_global_long_term()

        end_time = datetime.now()
        finish_pipeline_run(
            run_id,
            status="completed",
            details={
                "started_at": start_time,
                "finished_at": end_time,
                "duration_seconds": (end_time - start_time).total_seconds(),
            },
        )
        print("=" * 60)
        print(f"Retraining cycle completed successfully at {end_time}")
        print(f"Duration: {end_time - start_time}")
        print("=" * 60)

    except Exception as e:
        end_time = datetime.now()
        finish_pipeline_run(
            run_id,
            status="failed",
            details={
                "started_at": start_time,
                "finished_at": end_time,
                "duration_seconds": (end_time - start_time).total_seconds(),
            },
            error_message=str(e),
        )
        print("=" * 60)
        print("Retraining cycle FAILED")
        print(f"Start time: {start_time}")
        print(f"End time: {end_time}")
        print(f"Duration: {end_time - start_time}")
        print(f"Error: {e}")
        print("\nFull traceback:")
        traceback.print_exc()
        print("=" * 60)
        raise


if __name__ == "__main__":
    run()